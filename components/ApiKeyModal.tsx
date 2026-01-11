import React, { useState } from 'react';
import { testApiConnection } from '../services/geminiService';

interface ApiKeyModalProps {
  onSave: (key: string) => void;
  onClear?: () => void;
  hasKey?: boolean;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave, onClear, hasKey = false }) => {
  const [inputKey, setInputKey] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [status, setStatus] = useState<'none' | 'success' | 'error'>('none');
  const [statusMsg, setStatusMsg] = useState("");
  
  const handleCheckAndSave = async () => {
      const cleanKey = inputKey.trim();
      if (!cleanKey) return;
      
      setIsChecking(true);
      setStatus('none');
      
      try {
          await testApiConnection(cleanKey);
          setStatus('success');
          // Delay a bit to show success message then save
          setTimeout(() => {
              onSave(cleanKey);
          }, 1000);
      } catch (err: any) {
          console.error(err);
          setStatus('error');
          
          let msg = err.message || JSON.stringify(err);
          
          // Clean up JSON error if present
          if (msg.includes('"{')) {
              try {
                  const parsed = JSON.parse(msg.substring(msg.indexOf('{')));
                  if (parsed.error && parsed.error.message) {
                      msg = parsed.error.message;
                  }
              } catch (e) {}
          }

          if (msg.includes('404') || msg.includes('not found')) {
             setStatusMsg("Model AI không tìm thấy (404). Có thể Key chưa kích hoạt đầy đủ.");
          } else if (msg.includes('429')) {
             setStatusMsg("Server đang bận (429). Hãy thử lại sau 1-2 phút.");
          } else if (msg.includes('400') || msg.includes('INVALID_ARGUMENT') || msg.includes('API_KEY_INVALID')) {
             setStatusMsg("Key không hợp lệ. Vui lòng kiểm tra lại từng ký tự.");
          } else if (msg.includes('403')) {
             setStatusMsg("Key chưa được kích hoạt hoặc sai khu vực. Hãy tạo Key mới.");
          } else {
             setStatusMsg(`Lỗi kết nối: ${msg.slice(0, 60)}...`);
          }
      } finally {
          setIsChecking(false);
      }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 sm:p-8 relative">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 text-primary rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4">🔑</div>
          <h2 className="text-2xl font-bold text-slate-800">Cấu hình API Key Cá nhân</h2>
          <p className="text-slate-500 text-sm mt-2">Mỗi người dùng cần có 1 chìa khóa riêng để sử dụng miễn phí.</p>
        </div>
        
        <div className="space-y-5">
          {/* Hướng dẫn */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 space-y-2">
            <h3 className="font-bold text-slate-800 mb-2">Cách lấy Key miễn phí (1 phút):</h3>
            <p>1. Nhấn vào đường link bên dưới và đăng nhập Gmail.</p>
            <p>2. Nhấn nút màu xanh <span className="font-bold text-blue-600">"Get API key"</span>.</p>
            <p>3. Chọn <span className="font-bold">"Create API key in new project"</span>.</p>
            <p>4. Copy đoạn mã bắt đầu bằng chữ <code className="bg-slate-200 px-1 rounded text-red-600 font-mono">AIza...</code> và dán vào ô bên dưới.</p>
            
            <div className="pt-2 text-center">
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-1 text-primary hover:text-blue-700 font-bold hover:underline"
                >
                  👉 Bấm vào đây để lấy Key tại Google AI Studio
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Dán API Key của bạn vào đây:</label>
            <input 
              type="password" 
              value={inputKey}
              onChange={(e) => { setInputKey(e.target.value); setStatus('none'); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCheckAndSave();
                }
              }}
              placeholder="AIzaSy..."
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-mono text-sm"
            />
            {status === 'error' && <p className="text-red-600 text-xs mt-1 font-medium">{statusMsg}</p>}
            {status === 'success' && <p className="text-green-600 text-xs mt-1 font-bold">✅ Key hợp lệ! Đang lưu...</p>}
          </div>
          
          <div className="flex flex-col gap-3">
            <button 
              type="button"
              onClick={handleCheckAndSave}
              disabled={!inputKey || isChecking}
              className={`w-full py-3 text-white font-bold rounded-lg transition-all shadow-lg flex items-center justify-center gap-2
                ${status === 'success' ? 'bg-green-600' : 'bg-primary hover:bg-blue-700'}
                ${(!inputKey || isChecking) ? 'opacity-70 cursor-not-allowed' : ''}
              `}
            >
              {isChecking ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Đang tìm server tốt nhất...</span>
                  </>
              ) : (
                  <>
                    <span>{status === 'success' ? 'Thành công!' : 'Kiểm tra & Bắt đầu'}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </>
              )}
            </button>
            
            {hasKey && onClear && (
               <button 
                  type="button"
                  onClick={() => { setInputKey(""); onClear(); }}
                  className="w-full py-2 text-red-600 font-semibold hover:bg-red-50 rounded-lg text-sm border border-transparent hover:border-red-100 transition-colors"
               >
                 Xóa Key cũ / Đăng xuất
               </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;