const mongoose = require('mongoose');

// Version schema for document history
const versionSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  changeDescription: {
    type: String,
    default: 'Document updated'
  }
});

// Document schema with versioning
const documentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  collaborators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  versions: [versionSchema],
  currentVersion: {
    type: Number,
    default: 0
  },
  lastModified: {
    type: Date,
    default: Date.now
  },
  // For tracking active editors
  activeEditors: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    cursorPosition: Number,
    selection: {
      start: Number,
      end: Number
    },
    lastActive: Date
  }]
}, {
  timestamps: true
});

// Method to add a new version
documentSchema.methods.addVersion = function(content, author, changeDescription = 'Document updated') {
  this.versions.push({
    content,
    author,
    changeDescription,
    timestamp: new Date()
  });
  this.currentVersion = this.versions.length - 1;
  this.content = content;
  this.lastModified = new Date();
  return this.save();
};

// Method to revert to a specific version
documentSchema.methods.revertToVersion = function(versionIndex, userId) {
  if (versionIndex >= 0 && versionIndex < this.versions.length) {
    const versionContent = this.versions[versionIndex].content;
    return this.addVersion(
      versionContent, 
      userId, 
      `Reverted to version ${versionIndex + 1}`
    );
  }
  throw new Error('Invalid version index');
};

// Method to update active editors
documentSchema.methods.updateActiveEditor = function(userId, username, cursorPosition, selection) {
  const editorIndex = this.activeEditors.findIndex(editor => 
    editor.userId.toString() === userId.toString()
  );
  
  const editorData = {
    userId,
    username,
    cursorPosition,
    selection,
    lastActive: new Date()
  };
  
  if (editorIndex === -1) {
    this.activeEditors.push(editorData);
  } else {
    this.activeEditors[editorIndex] = editorData;
  }
  
  return this.save();
};

// Method to remove an active editor
documentSchema.methods.removeActiveEditor = function(userId) {
  this.activeEditors = this.activeEditors.filter(
    editor => editor.userId.toString() !== userId.toString()
  );
  return this.save();
};

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;
