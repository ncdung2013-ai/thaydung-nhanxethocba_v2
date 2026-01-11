import * as XLSX from 'xlsx';
import { StudentData, TeacherRole } from '../types';

/**
 * Checks if a string is likely a part of a student name.
 * Excludes common header keywords and non-name patterns.
 */
const isNamePart = (val: any): boolean => {
  if (typeof val !== 'string') return false;
  const str = val.trim();
  if (str.length === 0) return false;
  
  // FIX: Names rarely contain numbers.
  if (/\d/.test(str)) return false; 

  // FIX: Allow specific single letter names like "Ý"
  if (str.length < 2 && str.toUpperCase() !== 'Ý') return false;

  // Common header/system keywords to exclude (Expanded based on user feedback)
  const keywords = [
    'stt', 'họ', 'tên', 'thứ', 'ngày', 'tháng', 'năm', 'lớp', 'trường', 
    'dân', 'tộc', 'nữ', 'nam', 'điểm', 'trung', 'bình', 'xếp', 'loại',
    'ghi', 'chú', 'kết', 'quả', 'học', 'kỳ', 'môn', 
    // REMOVED 'toán', 'lý', 'hóa', 'sinh', 'sử', 'địa', 'anh', 'văn' because they are common names
    'gdcd', 'công', 'nghệ', 'tin', 'thể',
    'giáo', 'viên', 'người', 'lập', 'biểu', 'thống', 'kê',
    'tbm', 'đtb', 'hk1', 'hk2', 'cn', 'tốt', 'khá',
    // New exclusions for administrative headers & footers
    'ubnd', 'thcs', 'thpt', 'tiểu', 'phòng', 'sở', 'đào', 'tạo', 'cộng', 'hòa',
    'xã', 'huyện', 'tỉnh', 'thành', 'phố', 'độc', 'lập', 'tự', 'do',
    'đđg', 'tx', 'đgtx', 'đđgc', 'nhận', 'xét', 'khối',
    // Statistical keywords to exclude footer rows
    'số', 'lượng', 'tỉ', 'lệ', 'tỷ', 'phần', 'trăm', 'tổng',
    'sinh', 'đạt', 'chưa' 
  ];

  const lower = str.toLowerCase();
  
  // Check if string contains any keyword
  if (['stt', 'đđgtx', 'đđgck', 'đtbmhk'].some(k => lower === k)) return false;
  if (lower.includes('số lượng') || lower.includes('tỉ lệ') || lower.includes('tỷ lệ') || lower.includes('thống kê')) return false;
  if (lower.includes('số học sinh') || lower === 'đạt' || lower === 'chưa đạt') return false;

  // Check common headers
  // STRICT CHECK: Only filter if it MATCHES exactly a keyword in the list
  if (keywords.some(k => lower === k)) return false; 
  
  // FIX: Removed 'hòa' from includes check to prevent deleting "Lê Hòa"
  // Use 'cộng hòa' instead for header detection
  if (['trường', 'phòng', 'ủy', 'ban', 'cộng hòa'].some(k => lower.includes(k))) return false;
  
  // Check for ALL CAPS short strings that look like ratings or abbreviations (T, K, Đ, CĐ, TX1...)
  // Note: "Ý" is handled above, so it won't be blocked here if logic is correct
  if (/^(T|K|TB|Y|G|Đ|CĐ|TX\d|HK\d)$/.test(str.toUpperCase())) return false;

  return true;
};

/**
 * Parses raw text copied from Word/Excel/Web
 */
export const parseStringData = (text: string, role: TeacherRole): StudentData[] => {
  const lines = text.split(/\n+/);
  const students: StudentData[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    
    // Enhanced filtering for text paste as well
    if (lower.includes('họ và tên') || lower.startsWith('stt') || 
        lower.includes('người lập') || lower.includes('ngày') || 
        lower.includes('thcs') || lower.includes('ubnd') ||
        lower.includes('số lượng') || lower.includes('tỉ lệ') ||
        lower.includes('số học sinh')) return;

    let parts = trimmed.split('\t');
    
    if (parts.length < 2) {
       const match = trimmed.match(/^(.*?)(\d+[\.,]?\d*|[a-zA-ZĐđC]+)$/);
       if (match) {
         parts = [match[1], match[2]];
       } else {
         parts = [trimmed];
       }
    }

    const name = parts[0].trim();
    if (!name || /^\d+$/.test(name)) return;

    const cleanName = name.replace(/^\d+[\.\)\s]+/, '').trim();
    // Simple extraction for text mode: last part is score/rating
    const lastPart = parts.length > 1 ? parts[parts.length - 1].trim().replace(',', '.') : undefined;

    const student: StudentData = {
      id: `student-txt-${Date.now()}-${idx}`,
      name: cleanName,
      comment: '',
      isProcessing: false
    };

    if (lastPart) {
      if (role === TeacherRole.SUBJECT) {
         if (!isNaN(parseFloat(lastPart))) {
           student.subjectScore = parseFloat(lastPart);
         } else {
           student.subjectRating = lastPart.toUpperCase();
         }
      } else {
         // Basic support for GVCN text paste: if text matches rating, assign to academicResult
         if (/^(T|K|Đ|CĐ|G|TB|Y)$/i.test(lastPart)) {
             student.academicResult = lastPart.toUpperCase();
         }
      }
    }

    students.push(student);
  });

  return students;
};

/**
 * Tries to detect the subject name from header rows
 */
const detectSubject = (headers: any[][]): string | undefined => {
  const flatHeaders = headers.flat().join(' ').toLowerCase();

  // Mapping of keywords to Exact Subject Names from the list
  if (flatHeaders.includes('toán')) return 'Toán';
  if (flatHeaders.includes('văn') || flatHeaders.includes('việt') || flatHeaders.includes('ngữ')) return 'Văn';
  if (flatHeaders.includes('lịch sử') || flatHeaders.includes('địa lý') || flatHeaders.includes('sử') || flatHeaders.includes('địa')) return 'LS & ĐL';
  if (flatHeaders.includes('khoa học tự nhiên') || flatHeaders.includes('khtn') || flatHeaders.includes('lý') || flatHeaders.includes('hóa') || flatHeaders.includes('sinh') || flatHeaders.includes('vật lý') || flatHeaders.includes('vật lí') || flatHeaders.includes('sinh học') || flatHeaders.includes('hóa học')) return 'KHTN';
  if (flatHeaders.includes('tin') || flatHeaders.includes('tin học')) return 'Tin học';
  if (flatHeaders.includes('anh') || flatHeaders.includes('ngoại ngữ') || flatHeaders.includes('tiếng anh')) return 'Ng.ngữ';
  if (flatHeaders.includes('gdcd') || flatHeaders.includes('công dân')) return 'GDCD';
  if (flatHeaders.includes('công nghệ')) return 'C.nghệ';
  if (flatHeaders.includes('thể dục') || flatHeaders.includes('gdtc') || flatHeaders.includes('thể chất')) return 'GDTC';
  if (flatHeaders.includes('nhạc') || flatHeaders.includes('mỹ thuật') || flatHeaders.includes('âm nhạc') || flatHeaders.includes('nghệ thuật')) return 'Nghệ thuật';
  if (flatHeaders.includes('địa phương') || flatHeaders.includes('ndgdcđp')) return 'NDGDCĐP';
  if (flatHeaders.includes('trải nghiệm') || flatHeaders.includes('hướng nghiệp') || flatHeaders.includes('hđtn')) return 'HĐTN&HN';
  
  return undefined;
};

interface ParseResult {
  students: StudentData[];
  detectedSubject?: string;
}

/**
 * Parses Excel data using a heuristic row-scanning approach.
 */
export const parseExcelData = (fileData: ArrayBuffer | string, role: TeacherRole): ParseResult => {
  try {
    let workbook: XLSX.WorkBook;
    workbook = (typeof fileData === 'string') 
      ? XLSX.read(fileData, { type: 'string' }) 
      : XLSX.read(fileData, { type: 'array' });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) return { students: [] };
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return { students: [] };
    
    // Get raw data as array of arrays
    const rawData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });
    if (!rawData || rawData.length === 0) return { students: [] };

    // Detect Subject from the first 5 rows (usually header rows)
    const headerRows = rawData.slice(0, 5);
    const detectedSubject = detectSubject(headerRows);

    const students: StudentData[] = [];

    rawData.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length === 0) return;

      // --- STT Check (Crucial for filtering headers) ---
      let hasIndex = false;
      const firstCell = row[0];
      if (typeof firstCell === 'number' || (typeof firstCell === 'string' && /^\d+$/.test(firstCell.trim()))) {
          const val = Number(firstCell);
          if (val > 0 && val < 1000) { 
              hasIndex = true;
          }
      }

      // --- 1. Find the NAME ---
      let nameParts: string[] = [];
      let nameEndIndex = -1; 

      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        
        // Skip leading numbers (STT) if we haven't found name parts yet
        if (nameParts.length === 0 && (typeof cell === 'number' || (typeof cell === 'string' && /^\d+$/.test(cell.trim())))) {
            continue;
        }

        if (nameParts.length === 0) {
            if (isNamePart(cell)) {
                nameParts.push(String(cell).trim());
                nameEndIndex = i;
            }
        } else {
            // Merge adjacent text
            if (isNamePart(cell)) {
                nameParts.push(String(cell).trim());
                nameEndIndex = i;
            } else if (cell === undefined || cell === null || String(cell).trim() === '') {
                const nextCell = row[i+1];
                if (isNamePart(nextCell)) {
                    continue; 
                } else {
                    break; 
                }
            } else {
                break;
            }
        }
      }

      const fullName = nameParts.join(' ').trim();
      
      // --- FILTERING ---
      if (!fullName || fullName.length < 2) {
          // Double check if it's "Ý" (length 1)
          if (fullName !== 'Ý') return;
      }

      const upperName = fullName.toUpperCase();
      
      // Filter out School/Admin Headers
      if (upperName.includes("TRƯỜNG") || upperName.includes("THCS") || upperName.includes("THPT") || 
          upperName.includes("UBND") || upperName.includes("CỘNG HÒA") || upperName.includes("ĐỘC LẬP")) {
          return;
      }

      // Filter out Statistical Footer Rows
      if (upperName.includes("SỐ LƯỢNG") || 
          upperName.includes("TỈ LỆ") || 
          upperName.includes("TỶ LỆ") ||
          upperName.includes("TỔNG CỘNG") ||
          upperName.includes("THỐNG KÊ") ||
          upperName.startsWith("SỐ HỌC SINH") || 
          upperName === "ĐẠT" || 
          upperName === "CHƯA ĐẠT") {
          return;
      }
      
      if (fullName.includes("%") || (fullName.includes("-") && fullName.length > 5 && !fullName.includes(" "))) {
          return;
      }
      
      // --- 2. Extract Data based on Role ---
      let subjectScore: number | undefined = undefined;
      let subjectRating: string | undefined = undefined;
      let academicResult: string | undefined = undefined;
      let conductRating: string | undefined = undefined;
      let absences: number | undefined = undefined;

      if (role === TeacherRole.SUBJECT) {
          // Subject Teacher: Look for ONE score or rating backwards
          for (let j = row.length - 1; j > nameEndIndex; j--) {
            const cell = row[j];
            if (cell === undefined || cell === null || String(cell).trim() === '') continue;
            
            const cellStr = String(cell).trim().replace(',', '.');
            const cellNum = parseFloat(cellStr);

            if (!isNaN(cellNum)) {
                 if (cellNum >= 0 && cellNum <= 10) {
                     subjectScore = cellNum;
                     break; 
                 }
            } else {
                 const upper = cellStr.toUpperCase();
                 if (/^(T|K|Đ|CĐ|TB|G|Y|ĐẠT|CHƯA ĐẠT)$/.test(upper)) {
                     subjectRating = upper;
                     break; 
                 }
            }
          }
      } else {
          // Homeroom Teacher (GVCN): Look for MULTIPLE columns (HL, HK, Nghỉ) scanning forwards
          const ratingsFound: string[] = [];
          
          for (let j = nameEndIndex + 1; j < row.length; j++) {
              const cell = row[j];
              if (cell === undefined || cell === null || String(cell).trim() === '') continue;
              const str = String(cell).trim();
              const upper = str.toUpperCase();
              
              // Detect Rating (T/K/Đ/CĐ or Tốt/Khá/Giỏi/Yếu...)
              if (/^(T|K|Đ|CĐ|G|TB|Y|TỐT|KHÁ|ĐẠT|CHƯA ĐẠT|GIỎI|YẾU|TRUNG BÌNH|KÉM)$/.test(upper)) {
                  ratingsFound.push(upper);
                  continue; // Don't process as absence if it's a rating
              }
              
              // Detect Absences (Small Integer)
              if (/^\d+$/.test(str)) {
                 const n = parseInt(str, 10);
                 if (n >= 0 && n < 60) {
                     absences = n; 
                 }
              }
          }

          if (ratingsFound.length >= 2) {
              academicResult = ratingsFound[0];
              conductRating = ratingsFound[1];
          } else if (ratingsFound.length === 1) {
              academicResult = ratingsFound[0];
          }
      }

      // --- FINAL VALIDITY CHECK ---
      const hasData = (role === TeacherRole.SUBJECT) 
          ? (subjectScore !== undefined || subjectRating !== undefined)
          : (academicResult !== undefined || conductRating !== undefined || absences !== undefined);

      if (!hasIndex && !hasData) {
          return; 
      }

      const student: StudentData = {
        id: `student-xls-${Date.now()}-${rowIndex}`,
        name: fullName,
        comment: '',
        isProcessing: false,
        subjectScore,
        subjectRating,
        academicResult,
        conductRating,
        absences
      };

      students.push(student);
    });

    return { students, detectedSubject };

  } catch (e) {
    console.error("Excel Parsing Error:", e);
    return { students: [] };
  }
};