import { GoogleGenAI, Type, Schema } from "@google/genai";
import { StudentData, TeacherRole } from "../types";

// --- CẤU HÌNH API KEY ---
const getStoredKey = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('GEMINI_API_KEY') || "";
  }
  return "";
};

const getAIClient = () => {
  let apiKey = getStoredKey();

  if (!apiKey) {
    apiKey = process.env.API_KEY || "";
  }
  
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
  }

  return new GoogleGenAI({ apiKey });
};

// DANH SÁCH MODEL SẼ THỬ LẦN LƯỢT
// Cập nhật ưu tiên các model ổn định và mới nhất
const CANDIDATE_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite-preview-02-05", 
  "gemini-1.5-flash", 
  "gemini-flash-latest"
];

// Hàm lấy model đang hoạt động
const getActiveModel = (): string => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('GEMINI_ACTIVE_MODEL');
    if (stored) return stored;
  }
  return CANDIDATE_MODELS[0];
};

/**
 * Hàm wrapper để tự động thử lại khi gặp lỗi "Busy"
 */
const callWithRetry = async <T>(
  fn: () => Promise<T>, 
  retries: number = 3, 
  baseDelay: number = 3000 // Tăng delay mặc định lên 3s
): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const msg = error.message || "";
      const isTransient = msg.includes("429") || msg.includes("503") || msg.includes("overloaded") || msg.includes("quota");
      
      if (!isTransient || i === retries - 1) {
        throw error;
      }

      // Backoff: 3s -> 6s -> 9s
      const waitTime = baseDelay * (i + 1);
      console.warn(`Google Busy (Attempt ${i + 1}/${retries}). Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error("Retry failed");
};

export const testApiConnection = async (apiKey: string): Promise<boolean> => {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      console.log(`Testing connection with model: ${model}...`);
      await ai.models.generateContent({
        model: model,
        contents: "Hello",
      });
      
      if (typeof window !== 'undefined') {
         localStorage.setItem('GEMINI_ACTIVE_MODEL', model);
      }
      return true;

    } catch (e: any) {
      console.warn(`Model ${model} failed:`, e.message);
      lastError = e;
      const msg = e.message || "";
      if (msg.includes("400") || msg.includes("INVALID_ARGUMENT") || msg.includes("API_KEY_INVALID") || msg.includes("403")) {
         throw e;
      }
    }
  }
  throw lastError;
};

const normalizeSubjectName = (rawName?: string): string | undefined => {
  if (!rawName) return undefined;
  const s = rawName.toLowerCase();
  
  if (s.includes('toán')) return 'Toán';
  if (s.includes('văn') || s.includes('việt') || s.includes('ngữ')) return 'Văn';
  if (s.includes('ls') || s.includes('lịch sử') || s.includes('địa')) return 'LS & ĐL';
  if (s.includes('khtn') || s.includes('khoa học tự nhiên') || s.includes('lý') || s.includes('hóa') || s.includes('sinh') || s.includes('vật')) return 'KHTN';
  if (s.includes('tin')) return 'Tin học';
  if (s.includes('anh') || s.includes('ngoại ngữ')) return 'Ng.ngữ';
  if (s.includes('gdcd') || s.includes('công dân')) return 'GDCD';
  if (s.includes('công nghệ') || s.includes('c.nghệ')) return 'C.nghệ';
  if (s.includes('thể') || s.includes('gdtc')) return 'GDTC';
  if (s.includes('nhạc') || s.includes('mỹ thuật') || s.includes('nghệ thuật')) return 'Nghệ thuật';
  if (s.includes('địa phương') || s.includes('ndgdcđp')) return 'NDGDCĐP';
  if (s.includes('trải nghiệm') || s.includes('hướng nghiệp') || s.includes('hđtn')) return 'HĐTN&HN';
  
  return undefined;
};

export const extractDataFromMedia = async (
  base64Data: string,
  mimeType: string,
  role: TeacherRole
): Promise<{ students: StudentData[], detectedSubject?: string }> => {
  
  const ai = getAIClient(); 
  const modelName = getActiveModel();

  const prompt = role === TeacherRole.SUBJECT 
    ? `Bạn là trợ lý nhập liệu. Hãy phân tích hình ảnh/PDF bảng điểm này:
       1. TÌM TÊN MÔN HỌC: Đọc kỹ tiêu đề bảng.
       2. TRÍCH XUẤT DANH SÁCH HỌC SINH:
       - Cột họ tên: Lấy đầy đủ.
       - Cột điểm: Tìm cột điểm tổng kết cuối cùng.
       - Cột xếp loại: Tìm cột xếp loại hoặc Đ/CĐ.
       - Chỉ lấy dòng chứa thông tin học sinh.`
    : `Bạn là trợ lý nhập liệu. Trích xuất bảng tổng kết:
       - Họ tên.
       - Kết quả học tập (KQHT).
       - Kết quả rèn luyện (KQRL).
       - Số ngày nghỉ.`;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      subjectName: { type: Type.STRING, nullable: true },
      students: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            score: { type: Type.NUMBER, nullable: true },
            rating: { type: Type.STRING, nullable: true },
            kqht: { type: Type.STRING, nullable: true },
            kqrl: { type: Type.STRING, nullable: true },
            absences: { type: Type.NUMBER, nullable: true }
          },
          required: ["name"]
        }
      }
    },
    required: ["students"]
  };

  return callWithRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: modelName, 
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      const resultText = response.text;
      if (!resultText) return { students: [] };

      let rawData;
      try {
        rawData = JSON.parse(resultText);
      } catch (e) {
        // CLEANUP MARKDOWN
        const clean = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
           rawData = JSON.parse(clean);
        } catch (e2) {
           return { students: [] };
        }
      }
      
      const studentsList = rawData.students || (Array.isArray(rawData) ? rawData : []);
      const rawSubject = rawData.subjectName;

      const students = studentsList.map((item: any, idx: number) => ({
        id: `student-img-${Date.now()}-${idx}`,
        name: item.name || `Học sinh ${idx + 1}`,
        subjectScore: item.score,
        subjectRating: item.rating,
        academicResult: item.kqht,
        conductRating: item.kqrl,
        absences: item.absences,
        comment: '',
        isProcessing: false
      }));

      return { 
        students, 
        detectedSubject: normalizeSubjectName(rawSubject) 
      };

    } catch (error: any) {
      if (error.message === "MISSING_API_KEY") throw error;
      throw error; 
    }
  });
};

const getSubjectCharacteristics = (subject: string): string => {
    const s = subject.toLowerCase();
    if (s.includes('toán')) return 'Tập trung vào tư duy logic, kỹ năng tính toán, khả năng vận dụng công thức.';
    if (s.includes('văn') || s.includes('việt')) return 'Tập trung vào khả năng diễn đạt, dùng từ, cảm thụ văn học.';
    if (s.includes('ng.ngữ') || s.includes('anh')) return 'Tập trung vào từ vựng, ngữ pháp, kỹ năng giao tiếp.';
    if (s.includes('khtn')) return 'Tập trung vào kiến thức Vật lý, Hóa học, Sinh học và thực nghiệm.';
    if (s.includes('ls & đl')) return 'Tập trung vào sự kiện lịch sử và kỹ năng địa lý.';
    if (s.includes('gdcd')) return 'Tập trung vào ý thức đạo đức và ứng xử.';
    if (s.includes('tin')) return 'Tập trung vào thao tác máy tính và tư duy lập trình.';
    if (s.includes('thể')) return 'Tập trung vào thể lực và kỹ thuật động tác.';
    if (s.includes('nghệ thuật') || s.includes('nhạc') || s.includes('mỹ')) return 'Tập trung vào năng khiếu và sự sáng tạo.';
    return 'Tập trung vào thái độ học tập và mức độ hoàn thành nhiệm vụ.';
};

export const generateCommentsBatch = async (
  students: StudentData[],
  role: TeacherRole,
  subjectName: string = "Môn học"
): Promise<Map<string, string>> => {
  
  if (students.length === 0) return new Map();

  const ai = getAIClient();
  const modelName = getActiveModel();

  let logicRules = "";
  let roleInstruction = "";
  const wordLimit = role === TeacherRole.SUBJECT ? 12 : 20;

  if (role === TeacherRole.SUBJECT) {
      const characteristics = getSubjectCharacteristics(subjectName);
      roleInstruction = `Bạn là Giáo viên bộ môn dạy môn ${subjectName}.`;
      logicRules = `
        ĐẶC THÙ BỘ MÔN: ${characteristics}
        QUY TẮC NHẬN XÉT (TỐI ĐA ${wordLimit} CHỮ):
        - Điểm Giỏi (>= 8.0) hoặc Đạt Tốt: Khen ngợi năng lực đặc thù. (VD: "Học tốt, nắm chắc kiến thức.")
        - Điểm Khá (6.5 - 7.9): Ghi nhận sự cố gắng. (VD: "Có cố gắng, cần cẩn thận hơn.")
        - Điểm TB (5.0 - 6.4) hoặc Đạt: Nhắc nhở chăm chỉ. (VD: "Cần tập trung nghe giảng hơn.")
        - Điểm Yếu/Kém (< 5.0) hoặc Chưa đạt: Nhắc ôn tập cơ bản. (VD: "Cần ôn lại kiến thức cơ bản.")
      `;
  } else {
      roleInstruction = `Bạn là Giáo viên chủ nhiệm lớp.`;
      logicRules = `
        QUY TẮC NHẬN XÉT (TỐI ĐA ${wordLimit} CHỮ):
        - Tốt/Toàn diện: Khen ngợi ngoan ngoãn, học giỏi.
        - Khá: Ghi nhận ý thức phấn đấu.
        - Cần cố gắng: Khuyên cải thiện môn yếu hoặc thái độ.
        - Chuyên cần: Nhắc nhở nếu nghỉ nhiều.
      `;
  }

  const systemInstruction = `
    ${roleInstruction}
    Yêu cầu: Viết nhận xét ngắn gọn cho học bạ.
    KHÔNG QUÁ ${wordLimit} từ. Văn phong sư phạm.
    ${logicRules}
  `;

  const outputSchema: Schema = {
    type: Type.ARRAY,
    items: {
       type: Type.OBJECT,
       properties: {
          id: { type: Type.STRING },
          comment: { type: Type.STRING }
       },
       required: ["id", "comment"]
    }
  };

  const studentPayload = students.map(s => {
    if (role === TeacherRole.SUBJECT) {
      return {
        id: s.id,
        name: s.name,
        score: s.subjectScore !== undefined ? s.subjectScore : s.subjectRating
      };
    } else {
      return {
        id: s.id,
        name: s.name,
        kqht: s.academicResult,
        kqrl: s.conductRating,
        absences: s.absences
      };
    }
  });

  return callWithRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: JSON.stringify(studentPayload),
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: outputSchema,
          // TẮT BỘ LỌC AN TOÀN ĐỂ KHÔNG CHẶN NHẬN XÉT TIÊU CỰC
          safetySettings: [
             { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
             { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
             { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
             { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        },
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No response from AI");

      let parsedResults;
      try {
          parsedResults = JSON.parse(resultText);
      } catch {
          // Fallback: Tìm mảng JSON trong text hỗn loạn
          try {
              let jsonStr = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
              const firstBracket = jsonStr.indexOf('[');
              const lastBracket = jsonStr.lastIndexOf(']');
              if (firstBracket !== -1 && lastBracket !== -1) {
                  jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
              }
              parsedResults = JSON.parse(jsonStr);
          } catch (e2) {
              return new Map();
          }
      }
      
      const commentMap = new Map<string, string>();
      if (Array.isArray(parsedResults)) {
          parsedResults.forEach((item: any) => {
            if (item && item.id && item.comment) {
              commentMap.set(item.id, item.comment);
            }
          });
      }

      return commentMap;

    } catch (error: any) {
      if (error.message === "MISSING_API_KEY") throw error;
      throw error; 
    }
  });
};
