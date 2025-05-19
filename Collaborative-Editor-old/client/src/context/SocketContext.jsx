import { createContext, useContext, useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const { token, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  // Initialize socket connection when authenticated
  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    // Create socket connection
    const socketInstance = io(
      process.env.NODE_ENV === 'production'
        ? window.location.origin
        : 'http://localhost:5000',
      {
        auth: { token },
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      }
    );

    // Socket event handlers
    socketInstance.on('connect', () => {
      console.log('Socket connected');
      setConnected(true);
      setError(null);
    });

    socketInstance.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setError('Failed to connect to server');
      setConnected(false);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnected(false);
      
      if (reason === 'io server disconnect') {
        // The server has forcefully disconnected the socket
        setError('Disconnected by server. Please refresh the page.');
      } else {
        // Attempt to reconnect automatically
        socketInstance.connect();
      }
    });

    socketInstance.on('error', (err) => {
      console.error('Socket error:', err);
      setError(err.message || 'An error occurred with the connection');
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, [isAuthenticated, token]);

  // Join a document room
  const joinDocument = (documentId) => {
    if (!socket || !connected) return;
    
    socket.emit('join-document', { documentId });
  };

  // Leave a document room
  const leaveDocument = (documentId) => {
    if (!socket || !connected) return;
    
    socket.emit('leave-document', { documentId });
  };

  // Send document changes
  const sendDocumentChange = (documentId, patches, clientShadowVersion) => {
    if (!socket || !connected) return false;
    
    socket.emit('document-change', {
      documentId,
      patches,
      clientShadowVersion
    });
    
    return true;
  };

  // Send cursor position
  const sendCursorPosition = (documentId, cursorPosition, selection) => {
    if (!socket || !connected) return;
    
    socket.emit('cursor-position', {
      documentId,
      cursorPosition,
      selection
    });
  };

  // Save offline edit
  const saveOfflineEdit = (documentId, patches, timestamp) => {
    if (!socket || !connected) return false;
    
    socket.emit('save-offline-edit', {
      documentId,
      patches,
      timestamp
    });
    
    return true;
  };

  // Sync offline edits
  const syncOfflineEdits = (documentId) => {
    if (!socket || !connected) return false;
    
    socket.emit('sync-offline-edits', { documentId });
    return true;
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        error,
        joinDocument,
        leaveDocument,
        sendDocumentChange,
        sendCursorPosition,
        saveOfflineEdit,
        syncOfflineEdits
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
