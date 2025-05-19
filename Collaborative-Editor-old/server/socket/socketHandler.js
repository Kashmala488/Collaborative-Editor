const jwt = require('jsonwebtoken');
const DiffMatchPatch = require('diff-match-patch');
const Document = require('../models/Document');
const User = require('../models/User');

// Initialize diff-match-patch
const dmp = new DiffMatchPatch();

// In-memory cache for document shadows
const documentShadows = new Map();

// In-memory cache for offline edits
const offlineEdits = new Map();

/**
 * Differential Synchronization Algorithm Implementation
 * 
 * This implementation follows the principles outlined in Neil Fraser's paper:
 * https://neil.fraser.name/writing/sync/
 * 
 * The algorithm works as follows:
 * 1. Client and server maintain identical shadow copies of the document
 * 2. When a client makes changes, it:
 *    a. Computes the diff between its current text and its shadow
 *    b. Applies this diff to the shadow (making them identical)
 *    c. Sends the diff to the server
 * 3. When the server receives a diff, it:
 *    a. Applies the diff to its shadow copy
 *    b. Applies the same diff to the server's copy of the document
 *    c. Broadcasts the diff to all other clients
 * 4. When other clients receive the diff, they:
 *    a. Apply the diff to their shadow copy
 *    b. Apply the diff to their working copy
 * 
 * This approach handles conflicts by merging changes automatically,
 * with the diff-match-patch library handling the patching logic.
 */

// Helper function to authenticate socket connection using JWT
const authenticateSocket = async (socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication error: Token not provided'));
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }
    
    socket.user = {
      id: user._id,
      username: user.username,
      email: user.email
    };
    
    next();
  } catch (error) {
    return next(new Error('Authentication error: Invalid token'));
  }
};

// Helper function to get or create document shadow
const getDocumentShadow = async (documentId) => {
  if (!documentShadows.has(documentId)) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    documentShadows.set(documentId, document.content);
  }
  return documentShadows.get(documentId);
};

// Helper function to update document shadow
const updateDocumentShadow = (documentId, newContent) => {
  documentShadows.set(documentId, newContent);
};

// Helper function to apply patch to text
const applyPatch = (text, patches) => {
  const [patchedText, results] = dmp.patch_apply(patches, text);
  const success = results.every(result => result);
  return { patchedText, success };
};

// Setup Socket.IO handlers
module.exports = function(io) {
  // Use authentication middleware
  io.use(authenticateSocket);
  
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.username} (${socket.id})`);
    
    // Join a document room
    socket.on('join-document', async ({ documentId }) => {
      try {
        const document = await Document.findById(documentId);
        
        if (!document) {
          socket.emit('error', { message: 'Document not found' });
          return;
        }
        
        // Check if user has access to the document
        const isOwner = document.owner.toString() === socket.user.id;
        const isCollaborator = document.collaborators.some(
          collab => collab.toString() === socket.user.id
        );
        
        if (!isOwner && !isCollaborator) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
        
        // Join the document room
        socket.join(documentId);
        
        // Update active editors
        await document.updateActiveEditor(
          socket.user.id,
          socket.user.username,
          0, // Initial cursor position
          { start: 0, end: 0 } // Initial selection
        );
        
        // Get or initialize document shadow
        await getDocumentShadow(documentId);
        
        // Send document data to the client
        socket.emit('document-data', {
          document,
          activeEditors: document.activeEditors
        });
        
        // Notify other users that a new editor has joined
        socket.to(documentId).emit('editor-joined', {
          userId: socket.user.id,
          username: socket.user.username,
          activeEditors: document.activeEditors
        });
        
        // Check if there are any offline edits for this user and document
        const userOfflineEdits = offlineEdits.get(`${socket.user.id}-${documentId}`);
        if (userOfflineEdits && userOfflineEdits.length > 0) {
          socket.emit('offline-edits-available', {
            count: userOfflineEdits.length
          });
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });
    
    // Handle document changes using differential synchronization
    socket.on('document-change', async ({ documentId, patches, clientShadowVersion }) => {
      try {
        // Get the current document
        const document = await Document.findById(documentId);
        if (!document) {
          socket.emit('error', { message: 'Document not found' });
          return;
        }
        
        // Get the server's shadow copy
        const serverShadow = await getDocumentShadow(documentId);
        
        // Apply the patches to the server shadow
        const { patchedText: newServerShadow, success } = applyPatch(serverShadow, patches);
        
        if (!success) {
          // If patching failed, send the entire document back to the client
          socket.emit('sync-required', {
            content: document.content,
            serverShadowVersion: document.currentVersion
          });
          return;
        }
        
        // Update the server shadow
        updateDocumentShadow(documentId, newServerShadow);
        
        // Update the document in the database
        document.content = newServerShadow;
        document.lastModified = new Date();
        await document.save();
        
        // Broadcast the changes to all other clients in the room
        socket.to(documentId).emit('document-change', {
          patches,
          userId: socket.user.id,
          username: socket.user.username
        });
        
        // Periodically save a new version (e.g., after significant changes or time interval)
        // This is a simplified approach - in a real app, you might use more sophisticated criteria
        if (document.versions.length === 0 || 
            Date.now() - document.versions[document.versions.length - 1].timestamp > 60000) {
          await document.addVersion(
            newServerShadow,
            socket.user.id,
            'Auto-saved version'
          );
          
          // Notify all clients about the new version
          io.to(documentId).emit('version-created', {
            versionIndex: document.currentVersion,
            userId: socket.user.id,
            username: socket.user.username,
            timestamp: new Date()
          });
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });
    
    // Handle cursor position updates
    socket.on('cursor-position', async ({ documentId, cursorPosition, selection }) => {
      try {
        const document = await Document.findById(documentId);
        if (!document) {
          socket.emit('error', { message: 'Document not found' });
          return;
        }
        
        // Update active editor information
        await document.updateActiveEditor(
          socket.user.id,
          socket.user.username,
          cursorPosition,
          selection
        );
        
        // Broadcast cursor position to other clients
        socket.to(documentId).emit('cursor-position', {
          userId: socket.user.id,
          username: socket.user.username,
          cursorPosition,
          selection
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });
    
    // Handle offline edits
    socket.on('save-offline-edit', ({ documentId, patches, timestamp }) => {
      const key = `${socket.user.id}-${documentId}`;
      
      if (!offlineEdits.has(key)) {
        offlineEdits.set(key, []);
      }
      
      offlineEdits.get(key).push({
        patches,
        timestamp,
        userId: socket.user.id,
        username: socket.user.username
      });
      
      socket.emit('offline-edit-saved', { success: true });
    });
    
    // Handle sync of offline edits
    socket.on('sync-offline-edits', async ({ documentId }) => {
      try {
        const key = `${socket.user.id}-${documentId}`;
        const userOfflineEdits = offlineEdits.get(key) || [];
        
        if (userOfflineEdits.length === 0) {
          socket.emit('offline-edits-synced', { success: true, count: 0 });
          return;
        }
        
        const document = await Document.findById(documentId);
        if (!document) {
          socket.emit('error', { message: 'Document not found' });
          return;
        }
        
        // Get the server's shadow copy
        let serverShadow = await getDocumentShadow(documentId);
        let appliedCount = 0;
        
        // Sort edits by timestamp
        userOfflineEdits.sort((a, b) => a.timestamp - b.timestamp);
        
        // Apply each offline edit
        for (const edit of userOfflineEdits) {
          const { patchedText, success } = applyPatch(serverShadow, edit.patches);
          
          if (success) {
            serverShadow = patchedText;
            appliedCount++;
          }
        }
        
        if (appliedCount > 0) {
          // Update the server shadow
          updateDocumentShadow(documentId, serverShadow);
          
          // Update the document in the database
          document.content = serverShadow;
          document.lastModified = new Date();
          await document.save();
          
          // Create a new version
          await document.addVersion(
            serverShadow,
            socket.user.id,
            `Synced ${appliedCount} offline edits`
          );
          
          // Broadcast the new content to all clients
          io.to(documentId).emit('document-updated', {
            content: serverShadow,
            userId: socket.user.id,
            username: socket.user.username
          });
          
          // Notify about the new version
          io.to(documentId).emit('version-created', {
            versionIndex: document.currentVersion,
            userId: socket.user.id,
            username: socket.user.username,
            timestamp: new Date()
          });
        }
        
        // Clear the offline edits
        offlineEdits.delete(key);
        
        socket.emit('offline-edits-synced', { 
          success: true, 
          count: appliedCount 
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });
    
    // Leave a document
    socket.on('leave-document', async ({ documentId }) => {
      try {
        const document = await Document.findById(documentId);
        if (document) {
          // Remove user from active editors
          await document.removeActiveEditor(socket.user.id);
          
          // Notify other users
          socket.to(documentId).emit('editor-left', {
            userId: socket.user.id,
            username: socket.user.username,
            activeEditors: document.activeEditors
          });
        }
        
        socket.leave(documentId);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });
    
    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.user.username} (${socket.id})`);
      
      try {
        // Find all documents where this user is an active editor
        const documents = await Document.find({
          'activeEditors.userId': socket.user.id
        });
        
        // Remove user from active editors in all documents
        for (const document of documents) {
          await document.removeActiveEditor(socket.user.id);
          
          // Notify other users
          socket.to(document._id.toString()).emit('editor-left', {
            userId: socket.user.id,
            username: socket.user.username,
            activeEditors: document.activeEditors
          });
        }
      } catch (error) {
        console.error('Error handling disconnection:', error);
      }
    });
  });
};
