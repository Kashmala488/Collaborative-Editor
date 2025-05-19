import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import DiffMatchPatch from 'diff-match-patch';
import ReactMarkdown from 'react-markdown';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Badge from '@mui/material/Badge';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import SyncIcon from '@mui/icons-material/Sync';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useOffline } from '../context/OfflineContext';

// Initialize diff-match-patch
const dmp = new DiffMatchPatch();

const Editor = () => {
  const { id: documentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    socket, 
    connected, 
    joinDocument, 
    leaveDocument, 
    sendDocumentChange,
    sendCursorPosition,
    saveOfflineEdit,
    syncOfflineEdits
  } = useSocket();
  const { 
    isOnline, 
    saveDocumentOffline, 
    getOfflineDocument,
    saveOfflineEdit: saveOfflineEditLocal,
    getOfflineEdits,
    clearOfflineEdits,
    hasOfflineEdits
  } = useOffline();
  
  // Document state
  const [document, setDocument] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  
  // Editor state
  const [shadow, setShadow] = useState(''); // Client shadow copy for diff-sync
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [activeEditors, setActiveEditors] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [offlineEditsCount, setOfflineEditsCount] = useState(0);
  
  // Refs
  const editorRef = useRef(null);
  const lastSyncTimeRef = useRef(Date.now());
  const pendingChangesRef = useRef(false);
  const syncTimeoutRef = useRef(null);
  
  // Load document data
  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setLoading(true);
        setError(null);
        
        let documentData;
        
        if (isOnline) {
          // Fetch from API when online
          const response = await axios.get(`/api/documents/${documentId}`);
          documentData = response.data;
          
          // Save for offline use
          await saveDocumentOffline(documentId, documentData);
        } else {
          // Use offline data when offline
          documentData = getOfflineDocument(documentId);
          
          if (!documentData) {
            throw new Error('Document not available offline');
          }
        }
        
        setDocument(documentData);
        setContent(documentData.content);
        setShadow(documentData.content); // Initialize shadow copy
        
        // Load versions if online
        if (isOnline) {
          const versionsResponse = await axios.get(`/api/documents/${documentId}/versions`);
          setVersions(versionsResponse.data);
        }
        
        // Check for offline edits
        const offlineEdits = getOfflineEdits(documentId);
        setOfflineEditsCount(offlineEdits.length);
      } catch (err) {
        console.error('Error fetching document:', err);
        setError(err.message || 'Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [documentId, isOnline, saveDocumentOffline, getOfflineDocument, getOfflineEdits]);
  
  // Join document room when socket is connected
  useEffect(() => {
    if (connected && document) {
      joinDocument(documentId);
    }
    
    return () => {
      if (connected) {
        leaveDocument(documentId);
      }
    };
  }, [connected, document, documentId, joinDocument, leaveDocument]);
  
  // Socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    // Handle document data from server
    const handleDocumentData = (data) => {
      setDocument(data.document);
      setContent(data.document.content);
      setShadow(data.document.content); // Update shadow copy
      setActiveEditors(data.activeEditors || []);
    };
    
    // Handle document changes from other clients
    const handleDocumentChange = (data) => {
      // Apply patches to shadow copy
      const { patches } = data;
      const [patchedShadow] = dmp.patch_apply(patches, shadow);
      setShadow(patchedShadow);
      
      // Apply same patches to editor content
      const [patchedContent] = dmp.patch_apply(patches, content);
      setContent(patchedContent);
      
      // Update document
      setDocument(prev => ({
        ...prev,
        content: patchedContent,
        lastModified: new Date()
      }));
      
      // Show notification
      setSnackbar({
        open: true,
        message: `Changes received from ${data.username}`,
        severity: 'info'
      });
    };
    
    // Handle cursor position updates from other clients
    const handleCursorPosition = (data) => {
      setActiveEditors(prev => {
        const index = prev.findIndex(editor => 
          editor.userId.toString() === data.userId.toString()
        );
        
        if (index === -1) {
          return [
            ...prev,
            {
              userId: data.userId,
              username: data.username,
              cursorPosition: data.cursorPosition,
              selection: data.selection,
              lastActive: new Date()
            }
          ];
        }
        
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          cursorPosition: data.cursorPosition,
          selection: data.selection,
          lastActive: new Date()
        };
        
        return updated;
      });
    };
    
    // Handle editor joined event
    const handleEditorJoined = (data) => {
      setActiveEditors(data.activeEditors || []);
      setSnackbar({
        open: true,
        message: `${data.username} joined the document`,
        severity: 'info'
      });
    };
    
    // Handle editor left event
    const handleEditorLeft = (data) => {
      setActiveEditors(data.activeEditors || []);
      setSnackbar({
        open: true,
        message: `${data.username} left the document`,
        severity: 'info'
      });
    };
    
    // Handle version created event
    const handleVersionCreated = (data) => {
      // Fetch updated versions
      if (isOnline) {
        axios.get(`/api/documents/${documentId}/versions`)
          .then(response => {
            setVersions(response.data);
          })
          .catch(err => {
            console.error('Error fetching versions:', err);
          });
      }
      
      setSnackbar({
        open: true,
        message: `New version created by ${data.username}`,
        severity: 'success'
      });
    };
    
    // Handle sync required event
    const handleSyncRequired = (data) => {
      setContent(data.content);
      setShadow(data.content);
      
      setSnackbar({
        open: true,
        message: 'Document synchronized with server',
        severity: 'warning'
      });
    };
    
    // Handle document updated event (full content update)
    const handleDocumentUpdated = (data) => {
      setContent(data.content);
      setShadow(data.content);
      
      setSnackbar({
        open: true,
        message: `Document updated by ${data.username}`,
        severity: 'info'
      });
    };
    
    // Handle offline edits available notification
    const handleOfflineEditsAvailable = (data) => {
      setOfflineEditsCount(data.count);
      
      setSnackbar({
        open: true,
        message: `You have ${data.count} offline edits to sync`,
        severity: 'warning'
      });
    };
    
    // Handle offline edits synced confirmation
    const handleOfflineEditsSynced = (data) => {
      setOfflineEditsCount(0);
      
      setSnackbar({
        open: true,
        message: `${data.count} offline edits synced successfully`,
        severity: 'success'
      });
    };
    
    // Handle errors
    const handleError = (data) => {
      console.error('Socket error:', data);
      setError(data.message || 'An error occurred');
    };
    
    // Register event listeners
    socket.on('document-data', handleDocumentData);
    socket.on('document-change', handleDocumentChange);
    socket.on('cursor-position', handleCursorPosition);
    socket.on('editor-joined', handleEditorJoined);
    socket.on('editor-left', handleEditorLeft);
    socket.on('version-created', handleVersionCreated);
    socket.on('sync-required', handleSyncRequired);
    socket.on('document-updated', handleDocumentUpdated);
    socket.on('offline-edits-available', handleOfflineEditsAvailable);
    socket.on('offline-edits-synced', handleOfflineEditsSynced);
    socket.on('error', handleError);
    
    // Cleanup
    return () => {
      socket.off('document-data', handleDocumentData);
      socket.off('document-change', handleDocumentChange);
      socket.off('cursor-position', handleCursorPosition);
      socket.off('editor-joined', handleEditorJoined);
      socket.off('editor-left', handleEditorLeft);
      socket.off('version-created', handleVersionCreated);
      socket.off('sync-required', handleSyncRequired);
      socket.off('document-updated', handleDocumentUpdated);
      socket.off('offline-edits-available', handleOfflineEditsAvailable);
      socket.off('offline-edits-synced', handleOfflineEditsSynced);
      socket.off('error', handleError);
    };
  }, [socket, shadow, content, documentId]);
  
  // Periodic sync of changes
  useEffect(() => {
    const syncChanges = () => {
      if (!pendingChangesRef.current) return;
      
      // Calculate diff between current content and shadow
      const diff = dmp.diff_main(shadow, content);
      dmp.diff_cleanupSemantic(diff);
      
      // Create patches
      const patches = dmp.patch_make(shadow, content);
      
      if (patches.length === 0) {
        pendingChangesRef.current = false;
        return;
      }
      
      // Try to send changes to server
      if (isOnline && connected) {
        const sent = sendDocumentChange(documentId, patches, versions.length);
        
        if (sent) {
          // Update shadow to match current content
          setShadow(content);
          pendingChangesRef.current = false;
          lastSyncTimeRef.current = Date.now();
        }
      } else {
        // Store changes for offline sync
        const timestamp = Date.now();
        saveOfflineEditLocal(documentId, { patches, timestamp });
        setOfflineEditsCount(prev => prev + 1);
        
        // Update shadow locally
        setShadow(content);
        pendingChangesRef.current = false;
        lastSyncTimeRef.current = Date.now();
        
        // Show offline notification
        setSnackbar({
          open: true,
          message: 'Changes saved for offline sync',
          severity: 'warning'
        });
      }
    };
    
    // Set up periodic sync (every 2 seconds if there are changes)
    const interval = setInterval(() => {
      if (Date.now() - lastSyncTimeRef.current > 2000 && pendingChangesRef.current) {
        syncChanges();
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [
    documentId, 
    shadow, 
    content, 
    isOnline, 
    connected, 
    sendDocumentChange, 
    saveOfflineEditLocal,
    versions.length
  ]);
  
  // Handle content changes
  const handleContentChange = useCallback((e) => {
    const newContent = e.target.value;
    setContent(newContent);
    pendingChangesRef.current = true;
    
    // Debounce sync to avoid too frequent updates
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    
    syncTimeoutRef.current = setTimeout(() => {
      // If it's been more than 5 seconds since last sync, sync now
      if (Date.now() - lastSyncTimeRef.current > 5000) {
        // Calculate diff between current content and shadow
        const diff = dmp.diff_main(shadow, newContent);
        dmp.diff_cleanupSemantic(diff);
        
        // Create patches
        const patches = dmp.patch_make(shadow, newContent);
        
        if (patches.length === 0) {
          pendingChangesRef.current = false;
          return;
        }
        
        // Try to send changes to server
        if (isOnline && connected) {
          const sent = sendDocumentChange(documentId, patches, versions.length);
          
          if (sent) {
            // Update shadow to match current content
            setShadow(newContent);
            pendingChangesRef.current = false;
            lastSyncTimeRef.current = Date.now();
          }
        } else {
          // Store changes for offline sync
          const timestamp = Date.now();
          saveOfflineEditLocal(documentId, { patches, timestamp });
          setOfflineEditsCount(prev => prev + 1);
          
          // Update shadow locally
          setShadow(newContent);
          pendingChangesRef.current = false;
          lastSyncTimeRef.current = Date.now();
        }
      }
    }, 1000);
  }, [
    shadow, 
    documentId, 
    isOnline, 
    connected, 
    sendDocumentChange, 
    saveOfflineEditLocal,
    versions.length
  ]);
  
  // Track cursor position and selection
  const handleSelectionChange = useCallback(() => {
    if (!editorRef.current) return;
    
    const newCursorPosition = editorRef.current.selectionStart;
    const newSelection = {
      start: editorRef.current.selectionStart,
      end: editorRef.current.selectionEnd
    };
    
    setCursorPosition(newCursorPosition);
    setSelection(newSelection);
    
    // Send cursor position to server
    if (isOnline && connected) {
      sendCursorPosition(documentId, newCursorPosition, newSelection);
    }
  }, [documentId, isOnline, connected, sendCursorPosition]);
  
  // Handle manual save
  const handleSave = async () => {
    try {
      if (!isOnline) {
        setSnackbar({
          open: true,
          message: 'Cannot save while offline',
          severity: 'error'
        });
        return;
      }
      
      // Save document to server
      await axios.put(`/api/documents/${documentId}`, {
        content,
        changeDescription: 'Manual save'
      });
      
      // Update shadow
      setShadow(content);
      pendingChangesRef.current = false;
      
      // Fetch updated versions
      const versionsResponse = await axios.get(`/api/documents/${documentId}/versions`);
      setVersions(versionsResponse.data);
      
      setSnackbar({
        open: true,
        message: 'Document saved successfully',
        severity: 'success'
      });
    } catch (err) {
      console.error('Error saving document:', err);
      setSnackbar({
        open: true,
        message: 'Failed to save document',
        severity: 'error'
      });
    }
  };
  
  // Handle sync offline edits
  const handleSyncOfflineEdits = () => {
    if (!isOnline || !connected) {
      setSnackbar({
        open: true,
        message: 'Cannot sync while offline',
        severity: 'error'
      });
      return;
    }
    
    if (offlineEditsCount === 0) {
      setSnackbar({
        open: true,
        message: 'No offline edits to sync',
        severity: 'info'
      });
      return;
    }
    
    syncOfflineEdits(documentId);
    clearOfflineEdits(documentId);
  };
  
  // Handle version restore
  const handleRestoreVersion = async (versionIndex) => {
    try {
      if (!isOnline) {
        setSnackbar({
          open: true,
          message: 'Cannot restore versions while offline',
          severity: 'error'
        });
        return;
      }
      
      await axios.post(`/api/documents/${documentId}/revert/${versionIndex}`);
      
      // Fetch updated document
      const response = await axios.get(`/api/documents/${documentId}`);
      setDocument(response.data);
      setContent(response.data.content);
      setShadow(response.data.content);
      
      // Fetch updated versions
      const versionsResponse = await axios.get(`/api/documents/${documentId}/versions`);
      setVersions(versionsResponse.data);
      
      setSnackbar({
        open: true,
        message: `Restored to version ${versionIndex + 1}`,
        severity: 'success'
      });
      
      // Close history drawer
      setHistoryOpen(false);
    } catch (err) {
      console.error('Error restoring version:', err);
      setSnackbar({
        open: true,
        message: 'Failed to restore version',
        severity: 'error'
      });
    }
  };
  
  // Format date for display
  const formatDate = (dateString) => {
    const options = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };
  
  // Close snackbar
  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };
  
  // Go back to dashboard
  const handleBack = () => {
    navigate('/dashboard');
  };
  
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}>
        <CircularProgress />
      </Box>
    );
  }
  
  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
          Back to Dashboard
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      </Box>
    );
  }
  
  return (
    <Box className="editor-container">
      {/* Version History Drawer */}
      <Drawer
        anchor="right"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 320 } }}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Version History
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          {versions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No version history available
            </Typography>
          ) : (
            <List>
              {versions.map((version, index) => (
                <ListItem key={index} disablePadding>
                  <ListItemButton onClick={() => handleRestoreVersion(index)}>
                    <ListItemText
                      primary={`Version ${index + 1}: ${version.changeDescription}`}
                      secondary={
                        <>
                          {version.author?.username || 'Unknown user'}
                          {' — '}
                          {formatDate(version.timestamp)}
                        </>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Drawer>
      
      {/* Editor Toolbar */}
      <Box className="editor-main">
        <Box className="editor-toolbar">
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton onClick={handleBack} sx={{ mr: 1 }}>
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h6" noWrap>
              {document?.title || 'Untitled Document'}
            </Typography>
          </Box>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {!isOnline && (
              <Chip
                icon={<WifiOffIcon />}
                label="Offline"
                color="error"
                size="small"
              />
            )}
            
            {offlineEditsCount > 0 && (
              <Tooltip title="Sync offline edits">
                <Badge badgeContent={offlineEditsCount} color="error">
                  <IconButton 
                    onClick={handleSyncOfflineEdits}
                    disabled={!isOnline || !connected}
                  >
                    <SyncIcon />
                  </IconButton>
                </Badge>
              </Tooltip>
            )}
            
            <Tooltip title="Save document">
              <IconButton 
                onClick={handleSave}
                disabled={!isOnline || !connected}
              >
                <SaveIcon />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Version history">
              <IconButton 
                onClick={() => setHistoryOpen(true)}
                disabled={!isOnline}
              >
                <HistoryIcon />
              </IconButton>
            </Tooltip>
            
            <AvatarGroup max={3} sx={{ ml: 1 }}>
              {activeEditors
                .filter(editor => editor.userId.toString() !== user?.id)
                .map(editor => (
                  <Tooltip key={editor.userId} title={editor.username}>
                    <Avatar 
                      sx={{ width: 24, height: 24, bgcolor: 'secondary.main' }}
                    >
                      {editor.username.charAt(0).toUpperCase()}
                    </Avatar>
                  </Tooltip>
                ))}
            </AvatarGroup>
          </Box>
        </Box>
        
        {/* Editor Content */}
        <Box className="editor-content">
          <textarea
            ref={editorRef}
            className="editor-input"
            value={content}
            onChange={handleContentChange}
            onSelect={handleSelectionChange}
            onClick={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            placeholder="Start typing your markdown here..."
          />
          
          <Box className="editor-preview markdown-preview">
            <ReactMarkdown>
              {content}
            </ReactMarkdown>
          </Box>
        </Box>
      </Box>
      
      {/* Notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Editor;
