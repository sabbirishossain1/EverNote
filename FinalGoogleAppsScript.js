// Google Apps Script for EverNote App - WITH WORKERS SHEET
// Deploy this as a web app with "Anyone, even anonymous" access

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const notesSheet = ss.getSheets()[0]; // First sheet (Notes)
  let workersSheet;
  try {
    workersSheet = ss.getSheetByName("Workers");
  } catch (err) {
    // Create Workers sheet if it doesn't exist
    workersSheet = ss.insertSheet("Workers");
    workersSheet.getRange(1, 1, 1, 3).setValues([["ID", "Name", "Code"]]);
  }
  
  // Make sure Notes sheet has headers
  const notesHeaders = notesSheet.getRange(1, 1, 1, 4).getValues()[0];
  if (notesHeaders[0] !== "Agent") {
    notesSheet.getRange(1, 1, 1, 4).setValues([["Agent", "Number", "Date", "Note"]]);
  }
  
  const action = e.parameter.action;
  
  // --- NOTES ACTIONS ---
  if (action === "list") {
    const data = notesSheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === "save") {
    const agent = e.parameter.Agent || "";
    const number = e.parameter.Number || "";
    const date = e.parameter.Date || "";
    const note = e.parameter.Note || "";
    const rowNum = parseInt(e.parameter.rowNum || 0);
    
    if (rowNum > 1 && rowNum <= notesSheet.getLastRow()) {
      notesSheet.getRange(rowNum, 1, 1, 4).setValues([[agent, number, date, note]]);
    } else {
      notesSheet.appendRow([agent, number, date, note]);
    }
    return ContentService.createTextOutput("OK");
  }
  
  if (action === "delete") {
    const rowNum = parseInt(e.parameter.rowNum || 0);
    if (rowNum > 1 && rowNum <= notesSheet.getLastRow()) {
      notesSheet.deleteRow(rowNum);
    }
    return ContentService.createTextOutput("OK");
  }
  
  // --- WORKERS ACTIONS ---
  if (action === "listWorkers") {
    const data = workersSheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === "saveWorker") {
    const id = parseInt(e.parameter.id || 0);
    const name = e.parameter.name || "";
    const code = e.parameter.code || "";
    
    if (id > 0) {
      // Find existing worker by ID and update
      const data = workersSheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < data.length; i++) {
        if (parseInt(data[i][0]) === id) {
          foundRow = i + 1;
          break;
        }
      }
      if (foundRow > 1) {
        workersSheet.getRange(foundRow, 2, 1, 2).setValues([[name, code]]);
      }
    } else {
      // Add new worker
      const newId = workersSheet.getLastRow();
      workersSheet.appendRow([newId, name, code]);
    }
    return ContentService.createTextOutput("OK");
  }
  
  if (action === "deleteWorker") {
    const id = parseInt(e.parameter.id || 0);
    if (id > 0) {
      const data = workersSheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (parseInt(data[i][0]) === id) {
          workersSheet.deleteRow(i + 1);
          break;
        }
      }
    }
    return ContentService.createTextOutput("OK");
  }

  return ContentService.createTextOutput("OK");
}
