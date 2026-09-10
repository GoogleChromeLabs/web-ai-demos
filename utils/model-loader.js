// Define the model loader function
export function loadModel(modelUrl) {
  // Return a promise that resolves when the model is loaded
  return new Promise((resolve, reject) => {
    // Create a new XMLHttpRequest object
    const xhr = new XMLHttpRequest();

    // Set the request method and URL
    xhr.open('GET', modelUrl, true);

    // Set the response type to array buffer
    xhr.responseType = 'arraybuffer';

    // Define the onload event handler
    xhr.onload = () => {
      // Check if the request was successful
      if (xhr.status === 200) {
        // Resolve the promise with the loaded model
        resolve(xhr.response);
      } else {
        // Reject the promise with an error
        reject(new Error(`Failed to load model: ${xhr.statusText}`));
      }
    };

    // Define the onerror event handler
    xhr.onerror = () => {
      // Reject the promise with an error
      reject(new Error('Failed to load model'));
    };

    // Send the request
    xhr.send();
  });
}