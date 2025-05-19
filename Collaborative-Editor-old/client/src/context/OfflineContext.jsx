import { createContext, useContext, useState, useEffect } from 'react';
import localforage from 'localforage';

const OfflineContext = createContext();

export const useOffline = () => useContext(OfflineContext);

// Initialize localforage instances
const documentsStore = localforage.createInstance({
  name: 'collaborative-editor',
  storeName: 'documents'
});

const editsStore = localforage.createInstance({
  name: 'collaborative-editor',
  storeName: 'offline-edits'
});

export const OfflineProvider = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineEdits, setOfflineEdits] = useState({});
  const [offlineDocuments, setOfflineDocuments] = useState({});
  const [initialized, setInitialized] = useState(false);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load offline data on initialization
  useEffect(() => {
    const loadOfflineData = async () => {
      try {
        // Load offline documents
        const documents = {};
        await documentsStore.iterate((value, key) => {
          documents[key] = value;
        });
        setOfflineDocuments(documents);

        // Load offline edits
        const edits = {};
        await editsStore.iterate((value, key) => {
          edits[key] = value;
        });
        setOfflineEdits(edits);

        setInitialized(true);
      } catch (error) {
        console.error('Error loading offline data:', error);
        setInitialized(true);
      }
    };

    loadOfflineData();
  }, []);

  // Save document for offline use
  const saveDocumentOffline = async (documentId, document) => {
    try {
      await documentsStore.setItem(documentId, document);
      
      setOfflineDocuments(prev => ({
        ...prev,
        [documentId]: document
      }));
      
      return true;
    } catch (error) {
      console.error('Error saving document offline:', error);
      return false;
    }
  };

  // Get offline document
  const getOfflineDocument = (documentId) => {
    return offlineDocuments[documentId] || null;
  };

  // Save edit for offline sync
  const saveOfflineEdit = async (documentId, edit) => {
    try {
      const key = documentId;
      const currentEdits = offlineEdits[key] || [];
      const updatedEdits = [...currentEdits, edit];
      
      await editsStore.setItem(key, updatedEdits);
      
      setOfflineEdits(prev => ({
        ...prev,
        [key]: updatedEdits
      }));
      
      return true;
    } catch (error) {
      console.error('Error saving offline edit:', error);
      return false;
    }
  };

  // Get offline edits for a document
  const getOfflineEdits = (documentId) => {
    return offlineEdits[documentId] || [];
  };

  // Clear offline edits for a document
  const clearOfflineEdits = async (documentId) => {
    try {
      const key = documentId;
      await editsStore.removeItem(key);
      
      setOfflineEdits(prev => {
        const newEdits = { ...prev };
        delete newEdits[key];
        return newEdits;
      });
      
      return true;
    } catch (error) {
      console.error('Error clearing offline edits:', error);
      return false;
    }
  };

  // Get all available offline documents
  const getOfflineDocumentsList = () => {
    return Object.values(offlineDocuments);
  };

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        initialized,
        saveDocumentOffline,
        getOfflineDocument,
        saveOfflineEdit,
        getOfflineEdits,
        clearOfflineEdits,
        getOfflineDocumentsList,
        hasOfflineEdits: (documentId) => 
          (offlineEdits[documentId]?.length || 0) > 0
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
};
