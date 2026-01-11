import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StudentData, TeacherRole } from '../types';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface StudentListProps {
  students: StudentData[];
  role: TeacherRole;
  subjectName?: string;
  isGenerating?: boolean;
  onUpdateStudent: (id: string, updates: Partial<StudentData>) => void;
  onRegenerateSingle: (student: StudentData) => void;
  onRegenerateAll: () => void;
  onChangeSubject: (newSubject: string) => void;
  onDeleteStudent: (id: string) => void;
}

const SUBJECTS = [
  "Toán",
  "Văn",
  "LS & ĐL",
  "KHTN",
  "Tin học",
  "Ng.ngữ",
  "GDCD",
  "C.nghệ",
  "GDTC",
  "Nghệ thuật",
  "NDGDCĐP",
  "HĐTN&HN",
  "Khác ..."
];

const StudentList: React.FC<StudentListProps> = ({ 
  students, 
  role, 
  subjectName = "Toán",
  isGenerating = false,
  onUpdateStudent, 
  onRegenerateSingle,
  onRegenerateAll,
  onChangeSubject,
  onDeleteStudent
}) => {
  const tableRef = useRef<HTMLDivElement>(null);

  // --- Column Resizing Logic ---
  const [colWidths, setColWidths] = useState({
    stt: 50,
    name: 200,
    result: 150,
    comment: 400, // Default wider for comment
    action: 120 // Increased slightly for new button
  });

  const resizingRef = useRef<{ 
    col: keyof typeof colWidths; 
    startX: number; 
    startWidth: number 
  } | null>(null);

  const startResize = (e: React.MouseEvent, col: keyof typeof colWidths) => {
    e.preventDefault();
    resizingRef.current = {
      col,
      startX: e.clientX,
      startWidth: colWidths[col]
    };
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging
  };

  const doResize = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    const { col, startX, startWidth } = resizingRef.current;
    const diff = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + diff); // Min width 50px

    setColWidths(prev => ({
      ...prev,
      [col]: newWidth
    }));
  }, []);

  const stopResize = useCallback(() => {
    resizingRef.current = null;
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [doResize]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', doResize);
      document.removeEventListener('mouseup', stopResize);
    };
  }, [doResize, stopResize]);

  // --- End Resizing Logic ---

  const getStatusColor = (score?: number, rating?: string, kqht?: string) => {
    if (score !== undefined) {
      if (score >= 8) return 'text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded';
      if (score < 5) return 'text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded';
      return 'text-slate-700 font-semibold';
    }
    const r = (rating || kqht || '').toLowerCase();
    if (r.includes('tốt') || r === 't') return 'text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded';
    if (r.includes('chưa') || r === 'cđ' || r === 'kém') return 'text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded';
    return 'text-slate-700 font-semibold';
  };

  const exportExcel = () => {
    const exportData = students.map((s, idx) => ({
      STT: idx + 1,
      'Họ và tên': s.name,
      ...(role === TeacherRole.SUBJECT ? { 'Điểm/ĐG': s.subjectScore ?? s.subjectRating } : { 
        'KQHT': s.academicResult,
        'KQRL': s.conductRating,
        'Nghỉ': s.absences
      }),
      'Nhận xét': s.comment
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NhanXet");
    XLSX.writeFile(wb, `NhanXet_${role === TeacherRole.SUBJECT ? subjectName : 'GVCN'}.xlsx`);
  };

  const exportPDF = async () => {
    if (!tableRef.current) return;
    try {
      const canvas = await html2canvas(tableRef.current, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`NhanXet_${role === TeacherRole.SUBJECT ? subjectName : 'GVCN'}.pdf`);
    } catch (e) {
      console.error("Export PDF failed", e);
      alert("Lỗi khi xuất PDF. Vui lòng thử lại.");
    }
  };

  const exportImage = async () => {
    if (!tableRef.current) return;
    try {
      const canvas = await html2canvas(tableRef.current, { scale: 2 });
      const link = document.createElement('a');
      link.download = `NhanXet_${role === TeacherRole.SUBJECT ? subjectName : 'GVCN'}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (e) {
      console.error("Export Image failed", e);
      alert("Lỗi khi xuất ảnh.");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (students.length === 0) return null;

  // Reusable Resizer Component
  const Resizer = ({ col }: { col: keyof typeof colWidths }) => (
    <div
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 z-10 transition-colors opacity-0 hover:opacity-100 group-hover:opacity-50"
      onMouseDown={(e) => startResize(e, col)}
      onClick={(e) => e.stopPropagation()} // Prevent sort or other clicks
    />
  );

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 flex flex-col h-full overflow-hidden animate-fade-in">
      {/* TOOLBAR */}
      <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 backdrop-blur-sm">
        
        {/* Left: Role and Subject Selection */}
        <div className="flex items-center gap-4">
          <span className="font-bold text-slate-800 text-lg whitespace-nowrap flex items-center gap-2">
             <span className="bg-white px-2.5 py-0.5 rounded-md border border-slate-200 text-slate-700 text-sm shadow-sm">{students.length}</span>
             <span className="text-slate-600">Học sinh</span>
          </span>
          
          {role === TeacherRole.SUBJECT && (
             <div className="relative group">
                <select 
                  value={subjectName}
                  onChange={(e) => onChangeSubject(e.target.value)}
                  className="appearance-none bg-white border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block px-4 py-2 pr-8 font-semibold shadow-sm outline-none cursor-pointer hover:border-blue-400 transition-colors"
                >
                  <option value="" disabled>-Chọn môn-</option>
                  {SUBJECTS.map(subj => (
                    <option key={subj} value={subj}>{subj}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
             </div>
          )}
          
          {role === TeacherRole.HOMEROOM && (
             <span className="px-3 py-1 bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full text-xs font-bold uppercase tracking-wide">Giáo viên Chủ nhiệm</span>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
           {/* Regenerate Button */}
           <button
             onClick={onRegenerateAll}
             disabled={isGenerating}
             className={`flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-sm font-bold transition-all shadow-md shadow-blue-500/20 whitespace-nowrap active:scale-95 ${isGenerating ? 'opacity-70 cursor-wait' : ''}`}
           >
             {isGenerating ? (
               <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
             ) : (
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
             )}
             Tạo lại toàn bộ
           </button>
           
           <div className="w-px h-8 bg-slate-200 mx-1 shrink-0"></div>

           {/* Export Group - Compact */}
           <div className="flex bg-white rounded-lg shadow-sm border border-slate-300 divide-x divide-slate-300 shrink-0 overflow-hidden">
              <button
                onClick={exportExcel}
                className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-green-700 text-sm font-medium transition-colors flex items-center gap-1.5"
                title="Xuất Excel"
              >
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                <span className="hidden sm:inline">Excel</span>
              </button>
              <button
                onClick={exportPDF}
                className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-red-700 text-sm font-medium transition-colors flex items-center gap-1.5"
                title="Xuất PDF"
              >
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                <span className="hidden sm:inline">PDF</span>
              </button>
              <button
                onClick={exportImage}
                className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-blue-700 text-sm font-medium transition-colors flex items-center gap-1.5"
                title="Xuất Ảnh"
              >
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span className="hidden sm:inline">Ảnh</span>
              </button>
           </div>
        </div>
      </div>

      <div className="overflow-auto flex-1 bg-white p-4" ref={tableRef}>
        <div className="mb-4 text-center hidden" id="print-header">
           <h2 className="text-xl font-bold uppercase">Danh sách Nhận xét Học bạ</h2>
           <p className="text-slate-500">{role === TeacherRole.SUBJECT ? `Môn: ${subjectName}` : 'Giáo viên Chủ nhiệm'}</p>
        </div>
        <table className="w-full text-left border-collapse border border-slate-200 rounded-lg overflow-hidden" style={{ tableLayout: 'fixed' }}>
          <thead className="bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-wider sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="p-4 border border-slate-200 text-center relative group select-none" style={{ width: colWidths.stt }}>
                STT
                <Resizer col="stt" />
              </th>
              <th className="p-4 border border-slate-200 relative group select-none" style={{ width: colWidths.name }}>
                Họ và Tên
                <Resizer col="name" />
              </th>
              <th className="p-4 border border-slate-200 relative group select-none" style={{ width: colWidths.result }}>
                {role === TeacherRole.SUBJECT ? 'Điểm số' : 'Thông tin'}
                <Resizer col="result" />
              </th>
              <th className="p-4 border border-slate-200 relative group select-none" style={{ width: colWidths.comment }}>
                Nhận xét (Tối đa {role === TeacherRole.SUBJECT ? 12 : 20} chữ)
                <Resizer col="comment" />
              </th>
              <th data-html2canvas-ignore="true" className="p-4 border border-slate-200 text-center relative group select-none" style={{ width: colWidths.action }}>
                Tác vụ
                <Resizer col="action" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {students.map((student, index) => (
              <tr key={student.id} className="hover:bg-blue-50/50 transition-colors group">
                <td className="p-3 text-center text-slate-500 border border-slate-200 truncate font-mono text-sm">{index + 1}</td>
                <td className="p-3 font-semibold text-slate-800 border border-slate-200 truncate" title={student.name}>{student.name}</td>
                
                {/* Data Column */}
                <td className="p-3 text-sm border border-slate-200">
                  {role === TeacherRole.SUBJECT ? (
                     <div className="flex items-center">
                         <span className={getStatusColor(student.subjectScore, student.subjectRating)}>
                           {student.subjectScore !== undefined ? student.subjectScore : student.subjectRating}
                         </span>
                     </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 text-xs font-medium">
                       <span className="flex items-center gap-2">HT: <b className={getStatusColor(undefined, undefined, student.academicResult)}>{student.academicResult}</b></span>
                       <span className="flex items-center gap-2">RL: <b className="text-slate-700">{student.conductRating}</b></span>
                       {student.absences ? <span className="text-red-500 font-bold bg-red-50 px-1.5 rounded w-fit">Nghỉ: {student.absences}</span> : null}
                    </div>
                  )}
                </td>

                {/* Comment Column */}
                <td className="p-2 relative border border-slate-200 bg-white align-top">
                  {student.isProcessing ? (
                    // Skeleton Loading
                    <div className="w-full h-full min-h-[44px] flex flex-col gap-2 p-1 animate-pulse">
                       <div className="h-3 bg-slate-200 rounded w-3/4"></div>
                       <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                    </div>
                  ) : (
                    <div className="relative h-full group/textarea">
                      <textarea
                        className="w-full h-full min-h-[44px] bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 rounded-lg p-2 text-slate-800 leading-snug resize-none outline-none transition-all duration-200"
                        value={student.comment}
                        onChange={(e) => onUpdateStudent(student.id, { comment: e.target.value })}
                        placeholder={student.comment ? "" : "Chưa có nhận xét..."}
                        style={{ overflow: 'hidden' }}
                      />
                      <span data-html2canvas-ignore="true" className="absolute right-2 bottom-2 text-[10px] font-medium text-slate-400 pointer-events-none opacity-0 group-focus-within/textarea:opacity-100 transition-opacity bg-white px-1 rounded">
                        {student.comment ? student.comment.split(' ').filter(w => w.length > 0).length : 0} từ
                      </span>
                    </div>
                  )}
                </td>

                {/* Actions */}
                <td data-html2canvas-ignore="true" className="p-2 border border-slate-200 text-center bg-white align-middle">
                  <div className="flex justify-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                    <button
                      title="Copy"
                      onClick={() => copyToClipboard(student.comment)}
                      className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 012 2v-8a2 2 0 01-2-2h-8a2 2 0 01-2 2v8a2 2 0 012 2z" /></svg>
                    </button>
                    <button
                      title="Viết lại"
                      onClick={() => onRegenerateSingle(student)}
                      className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                    <button
                      title="Xóa dòng"
                      onClick={() => onDeleteStudent(student.id)}
                      className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StudentList;