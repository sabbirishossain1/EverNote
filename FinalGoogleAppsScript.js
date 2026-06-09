// Google Apps Script for EverNote App - SIMPLEST VERSION
// Deploy this as a web app with "Anyone, even anonymous" access

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const action = e.parameter.action;
  
  // Set headers if not present
  const headers = sheet.getRange(1, 1, 1, 4).getValues()[0];
  if (headers[0] !== "Agent") {
    sheet.getRange(1, 1, 1, 4).setValues([["Agent", "Number", "Date", "Note"]]);
  }
  
  if (action === "list") {
    const data = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === "save") {
    const agent = e.parameter.Agent || "";
    const number = e.parameter.Number || "";
    const date = e.parameter.Date || "";
    const note = e.parameter.Note || "";
    const rowNum = parseInt(e.parameter.rowNum || 0);
    
    if (rowNum > 1 && rowNum <= sheet.getLastRow()) {
      sheet.getRange(rowNum, 1, 1, 4).setValues([[agent, number, date, note]]);
    } else {
      sheet.appendRow([agent, number, date, note]);
    }
    return ContentService.createTextOutput("OK");
  }
  
  if (action === "delete") {
    const rowNum = parseInt(e.parameter.rowNum || 0);
    if (rowNum > 1 && rowNum <= sheet.getLastRow()) {
      sheet.deleteRow(rowNum);
    }
    return ContentService.createTextOutput("OK");
  }
  
  return ContentService.createTextOutput("OK");
}
