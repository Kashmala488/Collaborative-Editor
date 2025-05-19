# Collaborative Markdown Editor

A real-time collaborative markdown editor with features like differential synchronization, version history, and offline editing capabilities.

## Features

- **Real-time Collaboration**: Multiple users can edit documents simultaneously
- **Markdown Editing**: Edit markdown with a live preview
- **Differential Synchronization**: Efficient algorithm for handling conflicts between simultaneous edits
- **Version History**: Track document revisions and revert to previous versions
- **Cursor Position Tracking**: See where other users are editing in real-time
- **Offline Editing**: Continue editing when disconnected and sync when reconnected
- **User Authentication**: Secure user accounts and document access control

## Technology Stack

### Backend
- Node.js with Express
- MongoDB for document storage with versioning
- Socket.IO for real-time communication
- JWT for authentication
- diff-match-patch for differential synchronization

### Frontend
- React with Vite
- Material-UI for the user interface
- Socket.IO client for real-time updates
- React Markdown for preview rendering
- LocalForage for offline storage

## Synchronization Approach

This application implements a differential synchronization algorithm based on Neil Fraser's paper (https://neil.fraser.name/writing/sync/). The approach works as follows:

1. **Client-Server Shadow Copies**: Both client and server maintain identical "shadow" copies of the document
2. **Differential Synchronization**:
   - When a client makes changes, it computes the diff between its current text and its shadow
   - It applies this diff to its shadow (making them identical)
   - It sends the diff to the server
3. **Server Processing**:
   - The server applies the diff to its shadow copy
   - It applies the same diff to the server's copy of the document
   - It broadcasts the diff to all other clients
4. **Other Clients**:
   - Apply the diff to their shadow copy
   - Apply the diff to their working copy

This approach handles conflicts by merging changes automatically, with the diff-match-patch library handling the patching logic.

## Offline Capabilities

The application implements offline editing with the following approach:

1. Documents are cached locally using LocalForage
2. When offline, edits are stored locally with timestamps
3. When reconnected, the stored edits are synchronized with the server
4. Conflicts are resolved using the differential synchronization algorithm

## Setup and Installation

### Prerequisites
- Node.js (v14+)
- MongoDB

### Backend Setup
1. Navigate to the server directory:
   ```
   cd collaborative-editor/server
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with the following variables:
   ```
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/collaborative-editor
   JWT_SECRET=your_jwt_secret_key_here
   NODE_ENV=development
   ```

4. Start the server:
   ```
   npm run dev
   ```

### Frontend Setup
1. Navigate to the client directory:
   ```
   cd collaborative-editor/client
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Register a new account or log in
2. Create a new document or open an existing one
3. Start editing with markdown
4. Share the document URL with collaborators
5. View version history and revert to previous versions if needed
6. Continue editing even when offline - changes will sync when you reconnect

## License

MIT
