import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemSecondaryAction from '@mui/material/ListItemSecondaryAction';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import DescriptionIcon from '@mui/icons-material/Description';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';

const Dashboard = () => {
  const { user } = useAuth();
  const { isOnline, getOfflineDocumentsList } = useOffline();
  const navigate = useNavigate();
  
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [newDocumentTitle, setNewDocumentTitle] = useState('');
  const [titleError, setTitleError] = useState('');

  // Fetch documents on component mount
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setLoading(true);
        setError(null);
        
        if (isOnline) {
          const response = await axios.get('/api/documents');
          setDocuments(response.data);
        } else {
          // Use offline documents when offline
          const offlineDocuments = getOfflineDocumentsList();
          setDocuments(offlineDocuments);
        }
      } catch (err) {
        console.error('Error fetching documents:', err);
        setError('Failed to load documents. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchDocuments();
  }, [isOnline, getOfflineDocumentsList]);

  const handleOpenDialog = () => {
    setOpenDialog(true);
    setNewDocumentTitle('');
    setTitleError('');
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
  };

  const handleTitleChange = (e) => {
    setNewDocumentTitle(e.target.value);
    if (titleError) setTitleError('');
  };

  const handleCreateDocument = async () => {
    if (!newDocumentTitle.trim()) {
      setTitleError('Title is required');
      return;
    }

    try {
      if (!isOnline) {
        setError('Cannot create new documents while offline');
        handleCloseDialog();
        return;
      }

      const response = await axios.post('/api/documents', {
        title: newDocumentTitle.trim()
      });

      setDocuments([response.data, ...documents]);
      handleCloseDialog();
      
      // Navigate to the new document
      navigate(`/documents/${response.data._id}`);
    } catch (err) {
      console.error('Error creating document:', err);
      setError('Failed to create document. Please try again.');
    }
  };

  const handleEditDocument = (documentId) => {
    navigate(`/documents/${documentId}`);
  };

  const handleDeleteDocument = async (documentId) => {
    if (!isOnline) {
      setError('Cannot delete documents while offline');
      return;
    }

    if (window.confirm('Are you sure you want to delete this document?')) {
      try {
        await axios.delete(`/api/documents/${documentId}`);
        setDocuments(documents.filter(doc => doc._id !== documentId));
      } catch (err) {
        console.error('Error deleting document:', err);
        setError('Failed to delete document. Please try again.');
      }
    }
  };

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

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            My Documents
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleOpenDialog}
            disabled={!isOnline}
          >
            New Document
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
            <CircularProgress />
          </Box>
        ) : documents.length === 0 ? (
          <Box sx={{ textAlign: 'center', my: 4 }}>
            <Typography variant="body1" color="text.secondary">
              {isOnline 
                ? "You don't have any documents yet. Create one to get started!"
                : "No documents available offline. Connect to the internet to access your documents."}
            </Typography>
          </Box>
        ) : (
          <List>
            {documents.map((document) => (
              <Box key={document._id}>
                <ListItem>
                  <ListItemAvatar>
                    <Avatar>
                      <DescriptionIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={document.title}
                    secondary={
                      <>
                        <Typography component="span" variant="body2" color="text.primary">
                          {document.owner?.username === user?.username ? 'You' : document.owner?.username}
                        </Typography>
                        {' — Last modified: '}
                        {formatDate(document.lastModified || document.updatedAt)}
                      </>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton 
                      edge="end" 
                      aria-label="edit"
                      onClick={() => handleEditDocument(document._id)}
                    >
                      <EditIcon />
                    </IconButton>
                    {document.owner?._id === user?.id && (
                      <IconButton 
                        edge="end" 
                        aria-label="delete"
                        onClick={() => handleDeleteDocument(document._id)}
                        disabled={!isOnline}
                        sx={{ ml: 1 }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
                <Divider variant="inset" component="li" />
              </Box>
            ))}
          </List>
        )}
      </Box>

      {/* New Document Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog}>
        <DialogTitle>Create New Document</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Enter a title for your new document.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            id="title"
            label="Document Title"
            type="text"
            fullWidth
            variant="outlined"
            value={newDocumentTitle}
            onChange={handleTitleChange}
            error={!!titleError}
            helperText={titleError}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleCreateDocument} variant="contained">Create</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Dashboard;
