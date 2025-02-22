// Function to fetch data from the server and update the dashboard
async function fetchData() {
    try {
      // Fetch data from the server's /dashboard-data endpoint
      const response = await fetch('/dashboard-data');
      const data = await response.json();
  
      // Get the table body element
      const tbody = document.querySelector('#devicesTable tbody');
      tbody.innerHTML = ''; // Clear existing rows
  
      // Loop through each connected device and add a row to the table
      for (const [victimId, device] of Object.entries(data)) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${victimId}</td>
          <td>${device.ip}</td>
          <td>${new Date(device.connectionTime).toLocaleString()}</td>
          <td>${new Date(device.lastConnectionTime).toLocaleString()}</td>
          <td>${device.filesTransferred}</td>
          <td>${device.fileList.join(', ')}</td>
        `;
        tbody.appendChild(row);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  }
  
  // Fetch data every 5 seconds to keep the dashboard updated
  setInterval(fetchData, 5000);
  
  // Fetch data immediately when the page loads
  fetchData();