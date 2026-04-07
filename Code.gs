
function getSpreadsheet() {
  const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!SPREADSHEET_ID) {
    throw new Error('Spreadsheet ID not configured. Please set SPREADSHEET_ID in Script Properties.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

const ss = getSpreadsheet();

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('Service Contracts Management');
}

function normalize(str) {
  return str ? str.toString().trim().toLowerCase() : '';
}

function getPositions() {
  const sheet = ss.getSheetByName('Settings');
  const range = sheet.getRange("A2:A");
  const values = range.getValues();
  
  return values.map(row => row[0]).filter(item => item !== "");
}

function getProjectNumber() {
  const sheet = ss.getSheetByName('Settings');
  const range = sheet.getRange("C1");
  const value = range.getValue();

  return value;
}


const COLUMN_INDICES = {
  PROJECT_NAME: 9,
  RECORD_NUMBER: 12,
  RECORD_ID: 15
};

function readSheetData(sheetName) {
  try {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return null;
    }
    return sheet.getDataRange().getValues();
  } catch (error) {
    return null;
  }
}

function filterRowsByProject(data, projectName) {
  if (!data || data.length <= 1) return [];
  
  return data.slice(1).filter(row => 
    row.length > COLUMN_INDICES.PROJECT_NAME && 
    normalize(row[COLUMN_INDICES.PROJECT_NAME]) === normalize(projectName)
  );
}

function extractCurrentYearRecordNumbers(projectRows) {
  const recordNumbers = [];
  
  projectRows.forEach(row => {
    if (row.length <= COLUMN_INDICES.RECORD_NUMBER) return;
    
    const recordNum = row[COLUMN_INDICES.RECORD_NUMBER];
    if (recordNum && 
        typeof recordNum === 'string' && 
        isCurrentYearRecord(recordNum)) {
      recordNumbers.push(recordNum);
    }
  });
  
  return recordNumbers;
}


function sortRecordNumbers(recordNumbers) {
  return recordNumbers.sort((a, b) => {
    const matchA = a.match(YEAR_AGNOSTIC_PATTERN);
    const matchB = b.match(YEAR_AGNOSTIC_PATTERN);
    
    if (matchA && matchB) {
      const baseA = parseInt(matchA[2]);
      const baseB = parseInt(matchB[2]);
      
      if (baseA !== baseB) {
        return baseB - baseA;
      } else {
        const countA = matchA[3] ? parseInt(matchA[3]) : 1;
        const countB = matchB[3] ? parseInt(matchB[3]) : 1;
        return countB - countA;
      }
    }
    return 0;
  });
}

function extractBaseAndNextCount(lastRecordNumber) {
  let base = getProjectNumber();
  let nextCount = 1;
  
  if (lastRecordNumber) {
    const match = lastRecordNumber.match(YEAR_AGNOSTIC_PATTERN);
    if (match) {
      base = parseInt(match[2]);
      nextCount = match[3] ? parseInt(match[3]) + 1 : 2;
    }
  }
  
  return { base, nextCount };
}


function isValidProjectName(projectName) {
  return projectName && typeof projectName === 'string' && projectName.trim().length > 0;
}

const YEAR_AGNOSTIC_PATTERN = /^(\d{4})-(\d+)(?:\((\d+)\))?$/;

function getCurrentYear() {
  return new Date().getFullYear().toString();
}

function validateRecordNumber(recordNumber) {
  if (!recordNumber || typeof recordNumber !== 'string') return false;
  return YEAR_AGNOSTIC_PATTERN.test(recordNumber);
}

function extractYearFromRecord(recordNumber) {
  if (!recordNumber || typeof recordNumber !== 'string') return null;
  const match = recordNumber.match(YEAR_AGNOSTIC_PATTERN);
  return match ? match[1] : null;
}

function isCurrentYearRecord(recordNumber) {
  const year = extractYearFromRecord(recordNumber);
  return year === getCurrentYear();
}

function getProjectRecordInfo(projectName) {
  try {
    if (!isValidProjectName(projectName)) {
      return { base: getProjectNumber(), nextCount: 1, projectExists: false, lastRecordNumber: null };
    }

    const data = readSheetData('Data');
    if (!data) {
      return { base: getProjectNumber(), nextCount: 1, projectExists: false, lastRecordNumber: null };
    }

    if (data.length <= 1) {
      return { base: getProjectNumber(), nextCount: 1, projectExists: false, lastRecordNumber: null };
    }

    const projectRows = filterRowsByProject(data, projectName);
    const projectExists = projectRows.length > 0;
    
    if (!projectExists) {
      return { base: getProjectNumber(), nextCount: 1, projectExists: false, lastRecordNumber: null };
    }

    const recordNumbers = extractCurrentYearRecordNumbers(projectRows);
    
    if (recordNumbers.length === 0) {
      return { base: getProjectNumber(), nextCount: 1, projectExists: true, lastRecordNumber: null };
    }

    const sortedNumbers = sortRecordNumbers(recordNumbers);
    const lastRecordNumber = sortedNumbers[0];
    const { base, nextCount } = extractBaseAndNextCount(lastRecordNumber);

    return { 
      base, 
      nextCount, 
      projectExists: true, 
      lastRecordNumber 
    };
  } catch (error) {
    console.log("Error in getProjectRecordInfo:", error.toString());
    return { base: getProjectNumber(), nextCount: 1, projectExists: false, lastRecordNumber: null };
  }
}

function getNextRecordNumber(projectName) {
  const lock = LockService.getScriptLock();
  try {
    const lockAcquired = lock.waitLock(30000);
    if (!lockAcquired) {
      return "ERROR-LOCK";
    }
    
    const sheet = ss.getSheetByName('Data');
    if (!sheet) {
      console.log("Sheet 'Data' not found");
      return "1-1";
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return "1-1";
    }
    
    let maxCount = 0;
    const highestBaseCounts = new Map(); // Store counts for each base number
    const currentYear = getCurrentYear();
    
    data.slice(1).forEach(row => {
      // Skip if row doesn't have enough columns or project doesn't match
      if (row.length <= COLUMN_INDICES.PROJECT_NAME || 
          row.length <= COLUMN_INDICES.RECORD_NUMBER ||
          normalize(row[COLUMN_INDICES.PROJECT_NAME]) !== normalize(projectName)) {
        return;
      }
      
      const recordNum = row[COLUMN_INDICES.RECORD_NUMBER];
      if (recordNum && 
          typeof recordNum === 'string' && 
          isCurrentYearRecord(recordNum) && 
          validateRecordNumber(recordNum)) {
        
        const match = recordNum.match(YEAR_AGNOSTIC_PATTERN);
        if (match) {
          const baseNum = parseInt(match[2]);
          const count = match[3] ? parseInt(match[3]) : 1;
          
          // Track highest base number
          if (baseNum > maxCount) {
            maxCount = baseNum;
          }
          
          // Store counts for this base number
          if (!highestBaseCounts.has(baseNum)) {
            highestBaseCounts.set(baseNum, []);
          }
          highestBaseCounts.get(baseNum).push(count);
        }
      }
    });
    
    // If no records found for current year, get base project number
    if (maxCount === 0) {
      const baseNum = getProjectNumber();
      return `${baseNum}-1`;
    }
    
    // Get the highest count for the max base number
    const counts = highestBaseCounts.get(maxCount) || [1];
    let nextCount = 1;
    
    counts.forEach(count => {
      if (count >= 1) {
        nextCount = Math.max(nextCount, count + 1);
      }
    });
    
    return `${maxCount}-${nextCount}`;
  } catch (error) {
    console.error("Error in getNextRecordNumber:", error);
    return "ERROR-GENERIC";
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      console.error("Error releasing lock:", e);
    }
  }
}

function getProjectList() {
  try {
    // Check if spreadsheet is accessible
    if (!ss) {
      console.log("Spreadsheet not found");
      return [];
    }
    
    const sheet = ss.getSheetByName('Data');
    if (!sheet) {
      console.log("Sheet 'Data' not found");
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    console.log("Total rows found:", data.length);
    
    if (data.length <= 1) {
      console.log("Sheet is empty or has only headers");
      return [];
    }
    
    const projectMap = new Map();
    
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      const project = normalize(row[9] || "");
      
      if (project && project.trim() !== "" && !projectMap.has(project)) {
        projectMap.set(project, i);
      }
    }
    
    const sortedProjects = Array.from(projectMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0].toUpperCase());
    
    console.log("Final sorted projects (recent to old):", sortedProjects);
    
    return sortedProjects;
  } catch (error) {
    console.log("Error in getProjectList:", error.toString());
    console.log("Stack:", error.stack);
    return [];
  }
}

/**
 * Submits validated and sanitized data to the Google Sheet.
 * Addresses: Validation, Sanitization, Type Checking, and Length Limits.
 */
function submitData(payload) {
  try {
    // 1. Basic Payload Validation
    if (!payload || typeof payload !== 'object') {
      throw new Error("Invalid payload: Data must be an object.");
    }

    // 2. Define Schema and Constraints
    const schema = {
      name:     { type: 'string', max: 100, required: true },
      category: { type: 'string', max: 50,  required: true },
      amount:   { type: 'number', min: 0,    required: true },
      user:     { type: 'string', max: 50,  required: true }
    };

    const sanitizedData = {};

    // 3. Type Checking, Length Limits, and Sanitization
    for (const key in schema) {
      const rules = schema[key];
      let value = payload[key];

      // Check existence
      if (rules.required && (value === undefined || value === null || value === '')) {
        throw new Error(`Missing required field: ${key}`);
      }

      // Type Enforcement
      if (rules.type === 'number') {
        value = Number.parseFloat(value);
        if (isNaN(value)) throw new Error(`Field ${key} must be a number.`);
        if (rules.min !== undefined && value < rules.min) throw new Error(`${key} below minimum.`);
      } else if (rules.type === 'string') {
        // Basic Sanitization: Trim and escape potential formula injection
        value = String(value).trim();
        
        // Prevent Spreadsheet Injection (Excel/Sheets commands starting with =, +, -, @)
        if (value.startsWith('=') || value.startsWith('+') || value.startsWith('-') || value.startsWith('@')) {
          value = "'" + value; // Prepend apostrophe to treat as literal text
        }

        // Length Limits
        if (value.length > rules.max) {
          value = value.substring(0, rules.max);
        }
      }
      
      sanitizedData[key] = value;
    }

    // 4. Execution
    const ss = SpreadsheetApp.getActiveSpreadsheet(); // Ensure ss is defined
    const sheet = ss.getSheetByName('Data');
    if (!sheet) throw new Error("Target sheet 'Data' not found.");

    const row = [
      new Date(), 
      sanitizedData.name, 
      sanitizedData.category, 
      sanitizedData.amount, 
      sanitizedData.user
    ];

    sheet.appendRow(row);
    return { success: true };

  } catch (e) {
    console.error(`Submission Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function updateRecord(rowIndex, updatedRow) {
  try {
    const sheet = ss.getSheetByName('Data');
    if (!sheet) throw new Error("Sheet 'Data' not found");

    // 1. Validation: rowIndex
    // Ensure it's a number and within a reasonable range (not negative)
    if (typeof rowIndex !== 'number' || rowIndex < 0) {
      throw new Error(`Invalid rowIndex: ${rowIndex}`);
    }

    // 2. Validation: updatedRow
    // Ensure we actually have an array of data to work with
    if (!Array.isArray(updatedRow) || updatedRow.length === 0) {
      throw new Error("updatedRow must be a non-empty array");
    }

    const sheetRow = rowIndex + 2; 
    const maxRows = sheet.getMaxRows();
    
    if (sheetRow > maxRows) {
       throw new Error(`Row index ${sheetRow} exceeds sheet limits`);
    }

    // 3. Safe Data Transformation
    const dataToUpdate = updatedRow.map((cell, index) => {
      // Handle Column 0: Date conversion
      if (index === 0 && cell) {
        const dateObj = new Date(cell);
        return isNaN(dateObj.getTime()) ? cell : dateObj; 
      }

      // Columns 11, 12, 14, 15: Explicitly kept as strings
      const stringIndices = [11, 12, 14, 15];
      if (stringIndices.includes(index)) {
        return cell ? String(cell).trim() : '';
      }

      // Optional: Add Number.parseFloat logic for specific numeric columns here
      // Example: if (index === 5) return Number.parseFloat(cell) || 0;

      return cell;
    });

    // 4. Integrity Check: Ensure array length and add Timestamp
    const finalData = [...dataToUpdate];
    while (finalData.length < 16) {
      finalData.push('');
    }
    finalData[16] = new Date(); // Update Timestamp

    // 5. Execution
    sheet.getRange(sheetRow, 1, 1, 17).setValues([finalData]);
    
    return { success: true };

  } catch (e) {
    console.error("Update Error: " + e.message);
    return { success: false, error: e.message };
  }
}

function updateRecordById(recordId, updatedRow) {
  try {
    // 1. Validation: Ensure recordId is a valid string/number
    if (!recordId || typeof recordId === 'object') {
      throw new Error("Invalid Record ID provided.");
    }

    const sheet = ss.getSheetByName('Data');
    if (!sheet) {
      console.error("Sheet 'Data' not found");
      return JSON.stringify({ success: false, error: "Sheet not found" });
    }

    const data = sheet.getDataRange().getValues();
    let sheetRow = -1;

    // 2. Locate Record (Using Column P / Index 15)
    for (let i = 1; i < data.length; i++) {
      if (data[i][15] === recordId) {
        sheetRow = i + 1;
        break;
      }
    }

    if (sheetRow === -1) {
      return JSON.stringify({ success: false, error: "Record not found" });
    }

    // Fetch current state to merge updates
    const currentRow = sheet.getRange(sheetRow, 1, 1, 16).getValues()[0];

    // 3. Sanitization & Safe Parsing
    const sanitize = (val) => (typeof val === 'string' ? val.trim() : val);
    
    const safeSalary = (val) => {
      if (val === undefined || val === null || val === '') return currentRow[7];
      const parsed = Number.parseFloat(val);
      return isNaN(parsed) ? currentRow[7] : parsed;
    };

    // 4. Mapped Row with Nullish Coalescing
    const mappedRow = [
      currentRow[0],                                    // Timestamp/Original
      sanitize(updatedRow.lastName) || currentRow[1],
      sanitize(updatedRow.firstName) || currentRow[2],
      currentRow[3],
      currentRow[4],
      sanitize(updatedRow.gender) || currentRow[5],
      sanitize(updatedRow.position) || currentRow[6],
      safeSalary(updatedRow.salary),                   // Validated Float
      sanitize(updatedRow.email) || currentRow[8],
      sanitize(updatedRow.project) || currentRow[9],
      currentRow[10],
      currentRow[11],
      currentRow[12],
      currentRow[13],
      currentRow[14],
      currentRow[15]                                   // Maintain ID integrity
    ];

    // 5. Final Array Construction
    const dataWithTimestamp = [...mappedRow];
    
    // Ensure we are targeting the specific 17th column for "Last Updated"
    dataWithTimestamp[16] = new Date(); 

    // Perform the update
    sheet.getRange(sheetRow, 1, 1, 17).setValues([dataWithTimestamp]);

    return JSON.stringify({ success: true, message: "Record updated successfully" });

  } catch (e) {
    console.error("Update Error: " + e.toString());
    return JSON.stringify({ success: false, error: e.message });
  }
}

function submitBulkData(rows) {
  try {
    const sheet = ss.getSheetByName('Data');
    if (!sheet) throw new Error("Sheet 'Data' not found");

    // 1. Array Bounds & Content Validation
    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, error: "No data provided" };
    }

    // 2. Row Consistency Validation
    const expectedCols = rows[0].length;
    const sanitizedRows = rows.filter(row => {
      // Ensure row is an array and matches the header length
      return Array.isArray(row) && row.length === expectedCols;
    }).map(row => {
      // 3. Data Sanitization
      const processedRow = [...row]; // Shallow copy to avoid mutating original
      
      // Convert first column to Date, fallback to current date if invalid
      const dateVal = new Date(processedRow[0]);
      processedRow[0] = isNaN(dateVal.getTime()) ? new Date() : dateVal;
      
      // Optional: Trim strings to prevent trailing space issues
      return processedRow.map(cell => typeof cell === 'string' ? cell.trim() : cell);
    });

    if (sanitizedRows.length === 0) {
      return { success: false, error: "No valid rows to process" };
    }

    // 4. Batch Writing
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, sanitizedRows.length, expectedCols).setValues(sanitizedRows);
    
    return { 
      success: true, 
      count: sanitizedRows.length,
      skipped: rows.length - sanitizedRows.length 
    };

  } catch (e) {
    console.error("Submit Error: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDashboardStats(dateFrom, dateTo) {
  try {
    const startTime = Date.now();
    const sheet = ss.getSheetByName('Data');
    if (!sheet) {
      console.log("Sheet 'Data' not found");
      return { projects: 0, personnel: 0, recentActivity: 0 };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { projects: 0, personnel: 0, recentActivity: 0 };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // Columns A-J only
    
    const projects = new Set();
    let personnelCount = 0;
    let recentActivityCount = 0;
    
    let fromDate = null;
    let toDate = null;
    
    if (dateFrom && dateTo) {
      fromDate = new Date(dateFrom);
      toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
    }
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const recordDate = row[0] instanceof Date ? row[0] : new Date(row[0]);
      
      if (fromDate && toDate && recordDate) {
        if (recordDate < fromDate || recordDate > toDate) continue;
      }
      
      if (row[9]) projects.add(row[9]);
      
      if (row[1]) personnelCount++;
      
      if (recordDate && recordDate >= sevenDaysAgo) {
        recentActivityCount++;
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`Dashboard stats calculated in ${duration}ms for ${data.length} rows`);
    
    return {
      projects: projects.size,
      personnel: personnelCount,
      recentActivity: recentActivityCount
    };
  } catch (error) {
    console.log("Error in getDashboardStats:", error.toString());
    throw error;
  }
}


function readReportSheet() {
  try {
    
    const reportSheet = ss.getSheetByName('Report');
    if (!reportSheet) {
      return { success: false, error: "Report sheet not found" };
    }
    
    const data = reportSheet.getDataRange().getValues();
    
    if (!data || data.length === 0) {
      return { success: false, error: "Report sheet is empty" };
    }
    
    if (data.length < 2) {
      return { success: false, error: "No headers found in Report sheet" };
    }
    
    const headers = data[1];
    
    if (data.length < 3) {
      return {
        success: true,
        headers: headers,
        data: []
      };
    }
    
    const rows = data.slice(3).map((row, index) => {
      const obj = {};
      headers.forEach((header, headerIndex) => {
        obj[header] = row[headerIndex];
      });
      return obj;
    });
    
    return {
      success: true,
      headers: headers,
      data: rows
    };
  } catch (error) {
    console.error("❌ Error reading Report sheet:", error);
    console.error("❌ Error stack:", error.stack);
    return { success: false, error: error.toString() };
  }
}

function updateReportSheet(dateFrom, dateTo) {
  try {
    const reportSheet = ss.getSheetByName('Report');
    if (!reportSheet) {
      return { success: false, error: "Report sheet not found" };
    }
    
    const startDate = dateFrom ? new Date(dateFrom) : null;
    const endDate = dateTo ? new Date(dateTo) : null;
    
    if (startDate) {
      reportSheet.getRange('C1').setValue(startDate);
    }
    
    if (endDate) {
      reportSheet.getRange('E1').setValue(endDate);
    }
    
    
    return { 
      success: true, 
      message: `Report sheet updated with date range: ${dateFrom} to ${dateTo}` 
    };
  } catch (error) {
    console.error("Error updating Report sheet:", error);
    return { success: false, error: error.toString() };
  }
}

function getData() {
  try {
    const sheet = ss.getSheetByName('Data');
    const data = sheet.getDataRange().getValues();

    // Check if sheet exists
    if (!sheet) {
      console.error("Sheet 'Data' not found");
      return [];
    }

    if (data.length <= 1) {
      return [];
    }

    data.shift(); 
    
    const sanitizedData = data.map(row => {
      return row.map(cell => (cell instanceof Date) ? cell.toISOString() : cell);
    });

    return sanitizedData.reverse();
  } catch (e) {
    console.error("Error fetching data: " + e.toString());
    throw e;
  }
}
