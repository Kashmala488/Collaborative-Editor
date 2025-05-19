const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Document = require('../models/Document');
const User = require('../models/User');

const router = express.Router();

// Get all documents for the current user
router.get('/', auth, async (req, res) => {
  try {
    const documents = await Document.find({
      $or: [
        { owner: req.user.id },
        { collaborators: req.user.id }
      ]
    })
    .sort({ updatedAt: -1 })
    .populate('owner', 'username email')
    .populate('collaborators', 'username email');
    
    res.json(documents);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get a single document by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('owner', 'username email')
      .populate('collaborators', 'username email')
      .populate('activeEditors.userId', 'username');
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user has access to the document
    const isOwner = document.owner._id.toString() === req.user.id;
    const isCollaborator = document.collaborators.some(
      collab => collab._id.toString() === req.user.id
    );
    
    if (!isOwner && !isCollaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create a new document
router.post('/', auth, async (req, res) => {
  try {
    const { title, content = '' } = req.body;
    
    const document = new Document({
      title,
      content,
      owner: req.user.id,
      versions: [{
        content,
        author: req.user.id,
        changeDescription: 'Initial version'
      }]
    });
    
    await document.save();
    
    res.status(201).json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update a document
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, content, changeDescription } = req.body;
    
    let document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user has access to update the document
    const isOwner = document.owner.toString() === req.user.id;
    const isCollaborator = document.collaborators.some(
      collab => collab.toString() === req.user.id
    );
    
    if (!isOwner && !isCollaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Update document and add new version
    if (title) document.title = title;
    
    if (content !== undefined && content !== document.content) {
      await document.addVersion(content, req.user.id, changeDescription || 'Document updated');
    } else {
      document.lastModified = new Date();
      await document.save();
    }
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add a collaborator to a document
router.post('/:id/collaborators', auth, async (req, res) => {
  try {
    const { email } = req.body;
    
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user is the owner
    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the owner can add collaborators' });
    }
    
    // Find the user to add as collaborator
    const collaborator = await User.findOne({ email });
    
    if (!collaborator) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if user is already a collaborator
    if (document.collaborators.includes(collaborator._id)) {
      return res.status(400).json({ message: 'User is already a collaborator' });
    }
    
    // Add collaborator
    document.collaborators.push(collaborator._id);
    await document.save();
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove a collaborator from a document
router.delete('/:id/collaborators/:userId', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user is the owner or removing themselves
    if (document.owner.toString() !== req.user.id && req.params.userId !== req.user.id) {
      return res.status(403).json({ 
        message: 'Only the owner can remove collaborators or you can remove yourself' 
      });
    }
    
    // Remove collaborator
    document.collaborators = document.collaborators.filter(
      collab => collab.toString() !== req.params.userId
    );
    
    await document.save();
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get document version history
router.get('/:id/versions', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('versions.author', 'username email');
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user has access to the document
    const isOwner = document.owner.toString() === req.user.id;
    const isCollaborator = document.collaborators.some(
      collab => collab.toString() === req.user.id
    );
    
    if (!isOwner && !isCollaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json(document.versions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Revert to a specific version
router.post('/:id/revert/:versionIndex', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user has access to update the document
    const isOwner = document.owner.toString() === req.user.id;
    const isCollaborator = document.collaborators.some(
      collab => collab.toString() === req.user.id
    );
    
    if (!isOwner && !isCollaborator) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const versionIndex = parseInt(req.params.versionIndex);
    
    if (isNaN(versionIndex) || versionIndex < 0 || versionIndex >= document.versions.length) {
      return res.status(400).json({ message: 'Invalid version index' });
    }
    
    await document.revertToVersion(versionIndex, req.user.id);
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a document
router.delete('/:id', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check if user is the owner
    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the owner can delete the document' });
    }
    
    await document.remove();
    
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
