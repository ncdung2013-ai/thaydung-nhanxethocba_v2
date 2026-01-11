import React, { useState, useRef, useEffect } from 'react';
import { StudentData, TeacherRole } from './types';
import StudentList from './components/StudentList';
import ApiKeyModal from './components/ApiKeyModal';
import { generateCommentsBatch, extractDataFromMedia } from './services/geminiService';
import { parseExcelData } from './services/excelService';

function App() {
  const [role, setRole] = useState<TeacherRole>(TeacherRole.SUBJECT);
  const [students, setStudents] = useState<StudentData[]>([]);
  const [subjectName, setSubjectName] = useState<string>('Toán');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>(""); 
  const [showAbout, setShowAbout] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false); // UI State for Drag & Drop
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check key on init, if missing show modal
    const key = localStorage.getItem('GEMINI_API_KEY');
    if (!key) {
        setShowKeyModal(true);
    }
  }, []);

  const handleSaveKey = (key: string) => {
    localStorage.setItem('GEMINI_API_KEY', key);
    setShowKeyModal(false);
    setErrorMsg(null);
  };

  const handleClearKey = () => {
    localStorage.removeItem('GEMINI_API_KEY');
    setShowKeyModal(true);
  }

  // Helper to update specific student
  const updateStudent = (id: string, updates: Partial<StudentData>) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  // Helper to delete specific student
  const deleteStudent = (id: string) => {
    setStudents(prev => prev.filter(s => s.id !== id));
  };

  /**
   * Generates comments for a specific list of students (or current state if null)
   */
  const executeGeneration = async (targetStudents: StudentData[], currentSubject: string) => {
    if (targetStudents.length === 0) return;
    
    setIsGenerating(true);
    setErrorMsg(null);
    setStatusMsg("Đang chuẩn bị gửi dữ liệu...");
    
    // Mark all as processing first
    setStudents(prev => prev.map(s => ({ ...s, isProcessing: true })));

    try {
      // TỐI ƯU CÂN BẰNG:
      // Google Free Tier: 15 requests/phút (Trung bình 4 giây/request).
      // Chunk 5 học sinh -> 1 Request.
      // Cần delay tối thiểu 4s sau mỗi lần gọi để KHÔNG BỊ KHÓA KEY.
      const chunkSize = 5; 
      
      for (let i = 0; i < targetStudents.length; i += chunkSize) {
        const chunk = targetStudents.slice(i, i + chunkSize);
        
        // Cập nhật trạng thái
        const progress = Math.min(100, Math.round(((i) / targetStudents.length) * 100));
        setStatusMsg(`Đang xử lý nhóm học sinh ${i + 1} - ${Math.min(i + chunkSize, targetStudents.length)} (${progress}%)...`);

        // Gọi AI
        const commentsMap = await generateCommentsBatch(chunk, role, currentSubject);
        
        // Cập nhật State ngay sau khi có kết quả
        setStudents(prev => prev.map(s => {
          if (commentsMap.has(s.id)) {
            return { ...s, comment: commentsMap.get(s.id)!, isProcessing: false };
          }
          if (chunk.find(c => c.id === s.id)) {
             return { ...s, isProcessing: false };
          }
          return s;
        }));

        // DELAY BẮT BUỘC ĐỂ TRÁNH LỖI "QUOTA EXCEEDED"
        // Chỉ delay nếu chưa phải nhóm cuối cùng
        if (i + chunkSize < targetStudents.length) {
            const delayTime = 4; // 4 giây
            for (let t = delayTime; t > 0; t--) {
                setStatusMsg(`⏳ Đang "nghỉ" ${t}s để Google không chặn mạng... (${progress}%)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
      }
      setStatusMsg("");
    } catch (err: any) {
      console.error(err);
      if (err.message === "MISSING_API_KEY") {
         setShowKeyModal(true);
         setErrorMsg("Vui lòng nhập API Key để tiếp tục.");
      } else {
         const msg = err.message || "";
         if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
            setErrorMsg("⚠️ Đã hết lượt sử dụng trong phút này. Vui lòng đợi 1-2 phút rồi thử lại.");
         } else {
            setErrorMsg("Lỗi kết nối AI. Kiểm tra mạng hoặc thử lại sau.");
         }
      }
      setStudents(prev => prev.map(s => ({ ...s, isProcessing: false })));
      setStatusMsg("");
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Core logic to process a file object (Excel, PDF, Image)
   */
  const processFile = async (file: File) => {
    setErrorMsg(null);
    setStudents([]);

    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    let newStudents: StudentData[] = [];
    let detectedSub: string | undefined = undefined;

    // 1. Handle Excel
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileType.includes('sheet') || fileType.includes('excel')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = parseExcelData(arrayBuffer, role);
        newStudents = result.students;
        detectedSub = result.detectedSubject;

        if (newStudents.length === 0) {
          setErrorMsg("Không tìm thấy dữ liệu hợp lệ trong file Excel.");
        }
      } catch (err) {
        setErrorMsg("Lỗi khi đọc file Excel.");
      }
    } 
    // 2. Handle Image or PDF (AI Extraction)
    else if (fileType.startsWith('image/') || fileType === 'application/pdf') {
      setIsExtracting(true);
      try {
        const reader = new FileReader();
        // Wrap reader in promise to await result
        await new Promise<void>((resolve, reject) => {
            reader.onloadend = async () => {
              const resultStr = reader.result as string;
              const base64String = resultStr.split(',')[1];
              try {
                const result = await extractDataFromMedia(base64String, fileType, role);
                if (result.students.length === 0) {
                  setErrorMsg("AI không tìm thấy thông tin học sinh. Hãy thử ảnh rõ nét hơn.");
                } else {
                  newStudents = result.students;
                  detectedSub = result.detectedSubject;
                }
                resolve();
              } catch (err: any) {
                if (err.message === "MISSING_API_KEY") {
                    setShowKeyModal(true);
                } else {
                    const msg = err.message || "";
                    if (msg.includes("429") || msg.includes("quota")) {
                       setErrorMsg("⚠️ Google đang bận. Vui lòng thử lại sau 1 phút.");
                    } else {
                       setErrorMsg(err.message || "Lỗi khi AI xử lý file.");
                    }
                }
                resolve(); 
              }
            };
            reader.readAsDataURL(file);
        });
      } catch (err) {
        setErrorMsg("Lỗi đọc file từ máy.");
      } finally {
        setIsExtracting(false);
      }
    } else {
      setErrorMsg(`Định dạng file không hỗ trợ (${fileType}). Vui lòng dùng Excel, PDF hoặc Ảnh.`);
    }

    if (newStudents.length > 0) {
      setStudents(newStudents);
      
      const subToUse = detectedSub || subjectName;
      if (detectedSub) {
          setSubjectName(detectedSub);
      }

      // AUTO GENERATE IMMEDIATELY
      executeGeneration(newStudents, subToUse);
    }
  };

  // Handle Input Change
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    e.target.value = '';
  };

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]);
    }
  };

  // Handle Global Paste (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (showKeyModal) return; // Disable paste if modal open
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return; 
      }
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        const file = e.clipboardData.files[0];
        processFile(file);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [role, subjectName, showKeyModal]); 

  // Single Regenerate
  const handleRegenerateSingle = async (student: StudentData) => {
    updateStudent(student.id, { isProcessing: true });
    try {
      const map = await generateCommentsBatch([student], role, subjectName);
      if (map.has(student.id)) {
        updateStudent(student.id, { comment: map.get(student.id)!, isProcessing: false });
      } else {
        updateStudent(student.id, { isProcessing: false });
      }
    } catch (err: any) {
      updateStudent(student.id, { isProcessing: false });
      if (err.message === "MISSING_API_KEY") {
          setShowKeyModal(true);
      } else {
          const msg = err.message || "";
          if (msg.includes("429") || msg.includes("quota")) {
             setErrorMsg("⚠️ Hết lượt sử dụng. Vui lòng đợi một lát.");
          } else {
             setErrorMsg("Không thể tạo lại nhận xét.");
          }
      }
    }
  };

  // Triggered when Subject changes in StudentList or "Regenerate All" clicked
  const handleRegenerateAll = (newSubject?: string) => {
      const subj = newSubject || subjectName;
      if (newSubject) setSubjectName(newSubject);
      executeGeneration(students, subj);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50 relative selection:bg-blue-100">

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 shadow-sm transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-lg flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-500/20">
              AI
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-slate-600 tracking-tight hidden sm:block">
              Trợ lý Nhận xét Học bạ
            </h1>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight sm:hidden">Trợ lý Học bạ</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
              <button
                type="button"
                onClick={() => { setRole(TeacherRole.SUBJECT); setStudents([]); }}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-bold transition-all duration-200 ${role === TeacherRole.SUBJECT ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5 scale-100' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 scale-95'}`}
              >
                GV Bộ môn
              </button>
              <button
                type="button"
                onClick={() => { setRole(TeacherRole.HOMEROOM); setStudents([]); }}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-bold transition-all duration-200 ${role === TeacherRole.HOMEROOM ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5 scale-100' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 scale-95'}`}
              >
                GV Chủ nhiệm
              </button>
            </div>
            
            <div className="flex items-center border-l border-slate-300 pl-4 gap-2">
                {/* Settings Key Button */}
                <button
                  type="button"
                  onClick={() => setShowKeyModal(true)}
                  className="text-slate-400 hover:text-yellow-600 transition-colors p-2 rounded-full hover:bg-slate-100 active:scale-95 transform"
                  title="Cài đặt API Key"
                >
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                </button>

                {/* About Button */}
                <button 
                  type="button"
                  onClick={() => setShowAbout(true)}
                  className="text-slate-400 hover:text-primary transition-colors p-2 rounded-full hover:bg-slate-100 active:scale-95 transform"
                  title="Thông tin ứng dụng"
                >
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
        
        {/* Status Bar - Only show when generating */}
        {isGenerating && statusMsg && (
          <div className="bg-white border border-blue-100 text-blue-700 px-4 py-3 rounded-xl flex items-center justify-between shadow-lg shadow-blue-500/10 animate-fade-in ring-1 ring-blue-50">
             <div className="flex items-center gap-3">
               <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
               </span>
               <span className="font-semibold text-sm">{statusMsg}</span>
             </div>
             <div className="flex items-center gap-2">
                 <span className="text-xs text-slate-400 font-medium hidden sm:inline">Tránh lỗi 429</span>
                 <span className="text-xs bg-blue-50 px-2 py-1 rounded text-blue-600 border border-blue-200 font-bold uppercase tracking-wider">Safe Mode</span>
             </div>
          </div>
        )}

        {/* Input Section */}
        {students.length === 0 && (
          <section className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-8 transition-all animate-fade-in-up">
            <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                     <h2 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                       <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 text-sm font-bold flex items-center justify-center border border-blue-100">1</span>
                       Nhập dữ liệu học sinh
                     </h2>
                  </div>

                  {/* File Upload Button with Drag & Drop */}
                  <div 
                    className="relative group"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                     <label className={`
                       flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 relative overflow-hidden
                       ${isExtracting 
                          ? 'border-blue-300 bg-blue-50/50' 
                          : isDragging 
                              ? 'border-blue-500 bg-blue-50 scale-[1.02] shadow-xl shadow-blue-500/10' 
                              : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50/80 hover:shadow-md'
                       }
                     `}>
                        <div className="flex flex-col items-center justify-center pt-5 pb-6 z-10">
                            {isExtracting ? (
                               <div className="flex flex-col items-center gap-4">
                                  <div className="relative">
                                      <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                                      <div className="absolute inset-0 flex items-center justify-center text-xl">🧠</div>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-lg text-slate-800 font-bold">AI đang phân tích...</p>
                                    <p className="text-sm text-slate-500">Đang trích xuất bảng điểm từ hình ảnh</p>
                                  </div>
                                </div>
                            ) : (
                               <>
                                <div className={`flex items-center gap-4 mb-4 transition-transform duration-300 ${isDragging ? 'scale-110' : 'group-hover:scale-105'}`}>
                                  <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center text-3xl shadow-sm border border-green-100">📊</div>
                                  <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-3xl shadow-sm border border-red-100">📄</div>
                                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-3xl shadow-sm border border-blue-100">🖼️</div>
                                </div>
                                <div className="text-center px-4 space-y-2">
                                  <p className="text-lg text-slate-700 font-bold">
                                    {isDragging ? 'Thả file vào đây!' : 'Kéo thả file hoặc Click để chọn'}
                                  </p>
                                  <p className="text-sm text-slate-500 font-medium">
                                    Hỗ trợ Excel, PDF, hoặc Ảnh chụp bảng điểm
                                  </p>
                                  <div className="pt-2">
                                     <span className="inline-block px-3 py-1 bg-slate-100 text-slate-500 text-xs rounded-full font-mono">Ctrl + V để dán ảnh</span>
                                  </div>
                                </div>
                               </>
                            )}
                        </div>
                        <input 
                          ref={fileInputRef}
                          type="file" 
                          accept=".xlsx, .xls, .pdf, image/*" 
                          className="hidden" 
                          onChange={handleFileUpload}
                          disabled={isExtracting}
                        />
                     </label>
                  </div>
            </div>
            
            {errorMsg && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-center gap-3 animate-fade-in shadow-sm">
                <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center shrink-0 text-red-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <span className="font-medium">{errorMsg}</span>
              </div>
            )}
          </section>
        )}

        {/* Data Table Area */}
        {students.length > 0 && (
           <section className="flex-1 min-h-[500px] flex flex-col animate-fade-in-up">
              <StudentList 
                students={students} 
                role={role} 
                subjectName={subjectName}
                onUpdateStudent={updateStudent} 
                onRegenerateSingle={handleRegenerateSingle}
                onRegenerateAll={() => handleRegenerateAll()}
                onChangeSubject={(subj) => handleRegenerateAll(subj)}
                onDeleteStudent={deleteStudent}
                isGenerating={isGenerating}
              />
           </section>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center gap-2">
          <p className="text-sm font-semibold text-slate-600">
            Trợ lý Nhận xét Học bạ
          </p>
          <p className="text-xs text-slate-400">
             © 2026 – Nguyễn Chí Dũng | THCS Đoàn Bảo Đức | GDPT 2018 & TT22
          </p>
        </div>
      </footer>

      {/* Key Modal */}
      {showKeyModal && <ApiKeyModal onSave={handleSaveKey} onClear={handleClearKey} hasKey={!!localStorage.getItem('GEMINI_API_KEY')} />}

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
           <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative overflow-hidden transform transition-all scale-100">
              
              {/* Decorative Header Background */}
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 to-indigo-600"></div>

              <div className="flex justify-between items-start mb-6">
                 <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <span className="text-2xl">✨</span> Giới thiệu
                 </h3>
                 <button 
                   type="button"
                   onClick={() => setShowAbout(false)}
                   className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-1 transition-all"
                 >
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="space-y-4 text-slate-600 text-sm leading-relaxed">
                 <p className="font-medium text-slate-700">
                   Ứng dụng được xây dựng nhằm hỗ trợ giáo viên THCS trong việc viết nhận xét học bạ theo 
                   <span className="text-blue-600 font-bold"> Thông tư 22/2021/TT-BGDĐT</span> và 
                   <span className="text-blue-600 font-bold"> Chương trình GDPT 2018</span>.
                 </p>

                 <p>
                   Ứng dụng phi lợi nhuận, tập trung vào trải nghiệm người dùng tối giản và hiệu quả.
                 </p>

                 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                    <div className="flex items-center gap-3">
                       <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm text-lg">👨‍💻</div>
                       <div>
                          <strong className="block text-slate-800 text-xs uppercase tracking-wide">Tác giả</strong>
                          <a 
                            href="https://www.facebook.com/ncdung2013" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 font-semibold hover:underline transition-colors"
                          >
                            Nguyễn Chí Dũng
                          </a>
                       </div>
                    </div>
                    <div className="flex items-center gap-3">
                       <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm text-lg">🏫</div>
                       <div>
                          <strong className="block text-slate-800 text-xs uppercase tracking-wide">Đơn vị</strong>
                          <span className="text-slate-700 font-medium">THCS Đoàn Bảo Đức – An Giang</span>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="mt-8 text-center">
                 <button 
                   type="button"
                   onClick={() => setShowAbout(false)}
                   className="w-full px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-all shadow-lg shadow-slate-900/20 active:scale-95"
                 >
                   Đóng
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

export default App;