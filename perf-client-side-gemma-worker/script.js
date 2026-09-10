// Import the model loader utility
import { loadModel } from '../utils/model-loader.js';

// Define the model URL and size
const MODEL_URL = 'https://example.com/model.llama-33-70b-instruct';
const MODEL_SIZE = '1.2GB';

// Get the model size warning element
const modelSizeWarningElement = document.getElementById('model-size-warning');

// Display the model size warning
modelSizeWarningElement.innerText = `This demo will download a ${MODEL_SIZE} model. Please be patient, as this may take several minutes.`;

// Load the model
loadModel(MODEL_URL).then(() => {
  console.log('Model loaded successfully');
}).catch((error) => {
  console.error('Error loading model:', error);
});