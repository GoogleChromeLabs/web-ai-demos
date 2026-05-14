import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileText, Loader2, Plus, Trash2, AlertCircle, Bot, Scan, Info, CheckCircle2 } from 'lucide-react';

// Helper: use the top-level LanguageModel (Chrome 138+)
const getLanguageModelAPI = (): any => {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  return undefined;
};

interface InvoiceItem {
  id: string; // for React key
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number | string;
  totalAmount: number | string;
}

interface InvoiceFormData {
  senderCompany: string;
  senderVat: string;
  iban: string;
  bic: string;
  receiverCompany: string;
  receiverAddress: string;
  receiverVat: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
}

const emptyFormData: InvoiceFormData = {
  senderCompany: '',
  senderVat: '',
  iban: '',
  bic: '',
  receiverCompany: '',
  receiverAddress: '',
  receiverVat: '',
  invoiceNumber: '',
  issueDate: '',
  dueDate: '',
  items: [],
};

const generateId = () => self.crypto.randomUUID();

export default function App() {
  const [formData, setFormData] = useState<InvoiceFormData>(emptyFormData);
  const [isHovering, setIsHovering] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<{ step: 'idle' | 'ocr' | 'ai' | 'success' | 'error', message: string, progress?: number }>({ step: 'idle', message: '' });
  const [aiStatus, setAiStatus] = useState<'available' | 'downloading' | 'unavailable' | 'checking'>('checking');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Match the working playground pattern: just check if the global exists.
    // The playground does: if (!("LanguageModel" in self)) { ... }
    // It never calls availability() — that method may not behave as expected.
    const lm = getLanguageModelAPI();
    if (lm) {
      setAiStatus('available');
    } else {
      setAiStatus('unavailable');
    }
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const [debugInfo, setDebugInfo] = useState<{ ocrText: string; aiResponse: string } | null>(null);

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setOcrStatus({ step: 'error', message: 'Please upload a valid image file.' });
      return;
    }

    try {
      const lm = getLanguageModelAPI();
      if (aiStatus === 'unavailable' || !lm) {
        throw new Error('Chrome Local AI is not available. Click the info icon to learn how to enable it.');
      }

      setOcrStatus({ step: 'ai', message: 'Analyzing image with Chrome Local AI...' });

      // Keep the system prompt SHORT
      const SYSTEM_PROMPT = 'You are an expert invoice parser. Extract all data from scanned images into structured JSON. Reply with ONLY valid JSON, nothing else.';

      // Explicit, structured multimodal prompt
      const prompt = [
        {
          role: 'user',
          content: [
            { type: 'text', value: `Given this scanned invoice image, extract data into JSON.

Return a JSON object with exactly these keys:
- "senderCompany": company that SENT/issued the invoice
- "senderVat": sender VAT/tax ID (if any)
- "iban": bank IBAN (if any)
- "bic": bank BIC/SWIFT (if any)
- "receiverCompany": company/person BILLED TO
- "receiverAddress": billing address
- "receiverVat": receiver VAT ID (if any)
- "invoiceNumber": invoice number
- "issueDate": issue date
- "dueDate": due/payment date
- "items": array of objects, one for EACH AND EVERY line item found on the invoice.
  Each object MUST have exactly: {"description" (string), "quantity" (number), "unitPrice" (number), "vatRate" (number), "totalAmount" (number)}

CRITICAL: You MUST extract ALL items listed on the invoice. Do not skip any line items. Do not hallucinate.

Use "" for missing string fields, 0 for missing numbers. JSON only, no text.` },
            { type: 'image', value: file }
          ]
        }
      ];

      let aiResponseText = '';
      let session;

      try {
        // Create session with multimodal support
        session = await lm.create({
          expectedInputs: [{ type: 'image' }],
          initialPrompts: [
            { role: 'system', content: SYSTEM_PROMPT },
          ],
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              const progress = Math.round((e.loaded / e.total) * 100);
              setOcrStatus(prev => ({ ...prev, message: `Downloading model: ${progress}%...`, progress }));
            });
          },
        });

        // Multimodal prompt() call
        aiResponseText = await session.prompt(prompt as any);
      } finally {
        if (session) {
          session.destroy();
        }
      }

      console.log('=== AI RAW RESPONSE START ===');
      console.log(aiResponseText);
      console.log('=== AI RAW RESPONSE END ===');

      // Save debug info for the UI panel
      setDebugInfo({ ocrText: '[Multimodal Image Input]', aiResponse: aiResponseText });

      // The model may wrap JSON in ```json ... ``` — strip that
      let jsonStr = aiResponseText.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      // Also try to find a raw JSON object if there's surrounding text
      if (!jsonStr.startsWith('{')) {
        const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (braceMatch) jsonStr = braceMatch[0];
      }

      console.log('Extracted JSON string:', jsonStr);

      let parsedData: any;
      try {
        parsedData = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error('JSON parse failed. Raw AI response:', aiResponseText);
        throw new Error(`AI returned invalid JSON. Check console for details. First 200 chars: ${aiResponseText.substring(0, 200)}`);
      }
      
      // Auto-fill form — use nullish coalescing (??) not ||, so "0" or empty string still work
      setFormData(prev => ({
        ...prev,
        senderCompany: parsedData.senderCompany ?? prev.senderCompany,
        senderVat: parsedData.senderVat ?? prev.senderVat,
        iban: parsedData.iban ?? prev.iban,
        bic: parsedData.bic ?? prev.bic,
        receiverCompany: parsedData.receiverCompany ?? prev.receiverCompany,
        receiverAddress: parsedData.receiverAddress ?? prev.receiverAddress,
        receiverVat: parsedData.receiverVat ?? prev.receiverVat,
        invoiceNumber: parsedData.invoiceNumber ?? prev.invoiceNumber,
        issueDate: parsedData.issueDate ?? prev.issueDate,
        dueDate: parsedData.dueDate ?? prev.dueDate,
        items: Array.isArray(parsedData.items) 
          ? parsedData.items.map((it: any) => ({ ...it, id: generateId() })) 
          : prev.items,
      }));

      setOcrStatus({ step: 'success', message: 'Invoice successfully parsed and auto-filled!' });
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        setOcrStatus({ step: 'idle', message: '' });
      }, 5000);

    } catch (error: any) {
      console.error(error);
      setOcrStatus({ step: 'error', message: error.message || 'An error occurred during processing.' });
    }
    
    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (id: string, field: keyof InvoiceItem, value: string) => {
    setFormData(prev => {
      const newItems = prev.items.map(item => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: value };
          // Auto-calculate total if quantity or price changed
          if (field === 'quantity' || field === 'unitPrice' || field === 'vatRate') {
            const qty = Number(field === 'quantity' ? value : item.quantity) || 0;
            const price = Number(field === 'unitPrice' ? value : item.unitPrice) || 0;
            const vat = Number(field === 'vatRate' ? value : item.vatRate) || 0;
            updatedItem.totalAmount = (qty * price * (1 + vat/100)).toFixed(2);
          }
          return updatedItem;
        }
        return item;
      });
      return { ...prev, items: newItems };
    });
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { id: generateId(), description: '', quantity: 1, unitPrice: 0, vatRate: 19, totalAmount: 0 }]
    }));
  };

  const removeItem = (id: string) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const InputField = ({ label, name, type = 'text', required = false }: { label: string, name: keyof InvoiceFormData, type?: string, required?: boolean }) => (
    <div className="mb-3">
      <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1 tracking-wider">{label} {required && <span className="text-emerald-500">*</span>}</label>
      <input
        type={type}
        name={name}
        value={String(formData[name] || '')}
        onChange={handleInputChange}
        className="w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] outline-none transition-colors focus:border-indigo-600 focus:ring-[3px] focus:ring-indigo-600/10 shadow-sm"
      />
    </div>
  );

  return (
    <div className="h-screen w-full bg-slate-50 text-slate-900 font-[Inter,sans-serif] p-5 flex flex-col gap-5 overflow-hidden">
      
      {/* Header Section */}
      <header className="flex items-center justify-between bg-white px-6 py-4 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.1)] border border-slate-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-indigo-600 flex items-center gap-2">Invoice Engine</h1>
          {aiStatus === 'unavailable' ? (
            <span className="group relative flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 tracking-wide uppercase cursor-help">
              <AlertCircle size={10} /> AI Unavailable
              <div className="absolute top-full left-0 mt-2 w-72 p-3 bg-slate-800 text-white text-[11px] normal-case rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                Chrome Local AI (Gemini Nano) is disabled or blocked in the iFrame. Try clicking the "Open in new tab" icon (top-right of preview), or click the info icon for instructions on enabling flags.
              </div>
            </span>
          ) : aiStatus === 'available' ? (
             <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 tracking-wide uppercase flex items-center gap-1">
               <Bot size={10} /> Local AI Ready
             </span>
          ) : aiStatus === 'downloading' ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 tracking-wide uppercase flex items-center gap-1 animate-pulse">
              <Loader2 className="animate-spin" size={10} /> Model Downloading
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 tracking-wide uppercase flex items-center gap-1"><Loader2 className="animate-spin" size={10} /> Initializing</span>
          )}
        </div>
        <div className="flex gap-4">
          <a 
            href="https://developer.chrome.com/docs/ai/prompt-api"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center"
            title="Setup Instructions"
          >
            <Info size={18} />
          </a>
          <button className="px-4 py-2 rounded-lg font-semibold border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-sm transition-colors shadow-sm">
            Save Draft
          </button>
          <button className="px-4 py-2 rounded-lg font-semibold border border-transparent bg-indigo-600 text-white hover:bg-indigo-700 text-sm transition-colors shadow-sm">
            Issue Invoice
          </button>
        </div>
      </header>

      {/* Main Layout Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 flex-1 min-h-0">
        
        {/* Left Panel: Smart Scan & Sender Details */}
        <aside className="bg-white rounded-xl border border-slate-200 flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-[14px] font-semibold uppercase tracking-wider text-slate-500 bg-[#fafafa]">
            Smart Scan
          </div>
          <div className="p-4 overflow-y-auto flex-1">
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed border-indigo-600 rounded-lg p-6 text-center cursor-pointer transition-all bg-indigo-50 hover:bg-indigo-100 ${isHovering ? 'bg-indigo-100 ring-4 ring-indigo-500/20' : ''}`}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange} 
                accept="image/*" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              />
              
              {ocrStatus.step === 'ocr' || ocrStatus.step === 'ai' ? (
                <div className="absolute inset-0 bg-white/90 z-10 flex flex-col items-center justify-center rounded-lg space-y-2 p-4">
                  <div className="w-6 h-6 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                  <div className="text-xs font-semibold text-slate-700 text-center">{ocrStatus.message}</div>
                </div>
              ) : null}
              
              <div className="pointer-events-none relative z-0">
                <div className="text-3xl mb-2">📄</div>
                <div className="font-semibold text-sm text-slate-900">Drop scanned invoice</div>
                <div className="text-[11px] text-slate-500 mt-1">JPG, PNG or PDF (Simulated)</div>
              </div>
            </div>

            {/* Status Monitor for Error/Success */}
            {(ocrStatus.step === 'error' || ocrStatus.step === 'success') && (
              <div className={`mt-3 p-3 rounded text-xs font-medium flex items-center gap-2 ${ocrStatus.step === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {ocrStatus.step === 'error' ? <AlertCircle size={14} /> : <Scan size={14} />}
                {ocrStatus.message}
              </div>
            )}

            {/* Debug Panel */}
            {debugInfo && (
              <details className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                <summary className="px-3 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100">
                  🔍 Debug: OCR &amp; AI Output
                </summary>
                <div className="p-3 space-y-3 max-h-48 overflow-y-auto">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">OCR Text</div>
                    <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded whitespace-pre-wrap break-all max-h-24 overflow-y-auto border">{debugInfo.ocrText}</pre>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">AI Response</div>
                    <pre className="text-[10px] text-slate-600 bg-amber-50 p-2 rounded whitespace-pre-wrap break-all max-h-24 overflow-y-auto border border-amber-200">{debugInfo.aiResponse}</pre>
                  </div>
                </div>
              </details>
            )}

            <div className="mt-8">
              <div className="text-[14px] font-semibold uppercase tracking-wider text-slate-500 mb-4 pb-2 border-b border-transparent">
                Sender Details
              </div>
              <InputField label="Company Name" name="senderCompany" required />
              <InputField label="VAT ID" name="senderVat" />
              <InputField label="IBAN" name="iban" />
              <InputField label="BIC / SWIFT" name="bic" />
            </div>
          </div>
        </aside>

        {/* Right Panel: Invoice Construction */}
        <section className="bg-white rounded-xl border border-slate-200 flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-[14px] font-semibold uppercase tracking-wider text-slate-500 bg-[#fafafa]">
            Invoice Construction
          </div>
          <div className="p-4 overflow-y-auto flex-1">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Recipient Information */}
              <div>
                <label className="block text-indigo-600 border-b border-slate-100 pb-1 mb-4 text-sm font-semibold tracking-wide">Recipient Information</label>
                <InputField label="Customer Company" name="receiverCompany" required />
                <div className="mb-3">
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1 tracking-wider">Address</label>
                  <textarea
                    name="receiverAddress"
                    value={formData.receiverAddress || ''}
                    onChange={handleInputChange}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] outline-none transition-colors focus:border-indigo-600 focus:ring-[3px] focus:ring-indigo-600/10 resize-none shadow-sm"
                  />
                </div>
                <InputField label="Customer VAT ID" name="receiverVat" />
              </div>

              {/* Invoice Metadata */}
              <div>
                <label className="block text-indigo-600 border-b border-slate-100 pb-1 mb-4 text-sm font-semibold tracking-wide">Invoice Metadata</label>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Invoice Number" name="invoiceNumber" required />
                  <InputField label="Issue Date" name="issueDate" type="date" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Due Date" name="dueDate" type="date" />
                  <div className="mb-3">
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1 tracking-wider">Currency</label>
                    <input
                      type="text"
                      value="EUR (€)"
                      readOnly
                      className="w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] outline-none bg-slate-50 text-slate-500 cursor-not-allowed shadow-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="mt-8">
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm font-semibold text-slate-900 tracking-wide m-0">Line Items</label>
                <button 
                  onClick={addItem}
                  className="px-3 py-1 text-[11px] font-semibold border border-indigo-600 text-indigo-600 rounded bg-transparent hover:bg-indigo-50 transition-colors cursor-pointer shadow-sm"
                >
                  + Add Row
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <table className="w-full text-left text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 border-b-2 border-slate-200">
                      <th className="px-3 py-2.5 font-semibold w-1/2">Description</th>
                      <th className="px-3 py-2.5 font-semibold">Qty</th>
                      <th className="px-3 py-2.5 font-semibold">Unit Price</th>
                      <th className="px-3 py-2.5 font-semibold">VAT</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                      <th className="px-3 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.items.map((item, index) => (
                      <tr key={item.id} className="border-b border-slate-200 last:border-0 hover:bg-slate-50/50">
                        <td className="p-2.5">
                          <input 
                            type="text" 
                            value={item.description}
                            onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                            className="w-full px-2 py-1.5 border border-transparent hover:border-slate-300 focus:border-indigo-600 rounded text-[13px] outline-none transition-colors focus:bg-white bg-transparent"
                            placeholder="Service description"
                          />
                        </td>
                        <td className="p-2.5">
                          <input 
                            type="number" 
                            value={item.quantity}
                            onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value)}
                            className="w-16 px-2 py-1.5 border border-transparent hover:border-slate-300 focus:border-indigo-600 rounded text-[13px] outline-none transition-colors focus:bg-white bg-transparent"
                          />
                        </td>
                        <td className="p-2.5">
                          <input 
                            type="number" 
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => handleItemChange(item.id, 'unitPrice', e.target.value)}
                            className="w-24 px-2 py-1.5 border border-transparent hover:border-slate-300 focus:border-indigo-600 rounded text-[13px] outline-none transition-colors focus:bg-white bg-transparent"
                          />
                        </td>
                        <td className="p-2.5">
                          <select
                            value={item.vatRate}
                            onChange={(e) => handleItemChange(item.id, 'vatRate', e.target.value)}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-[12px] bg-white text-slate-800 outline-none focus:border-indigo-600 shadow-sm"
                          >
                            <option value="0">0%</option>
                            <option value="7">7%</option>
                            <option value="19">19%</option>
                            <option value="20">20%</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-right font-semibold text-slate-800">
                          €{Number(item.totalAmount || 0).toFixed(2)}
                        </td>
                        <td className="p-2.5 text-center">
                          <button 
                            onClick={() => removeItem(item.id)}
                            className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded cursor-pointer"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {formData.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                          No items added. Add rows manually or scan an invoice to auto-fill.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Totals Summary */}
              {formData.items.length > 0 && (
                <div className="mt-5 flex justify-end">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-500">Subtotal:</span>
                      <span className="text-[13px] font-semibold text-slate-800">
                        €{formData.items.reduce((acc, item) => acc + (Number(item.quantity || 0) * Number(item.unitPrice || 0)), 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-500">VAT Total:</span>
                      <span className="text-[13px] font-semibold text-slate-800">
                        €{formData.items.reduce((acc, item) => {
                          const itemTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
                          return acc + (itemTotal * (Number(item.vatRate || 0) / 100));
                        }, 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t-2 border-indigo-600 mt-2">
                      <span className="font-bold text-slate-900">Grand Total:</span>
                      <span className="font-bold text-indigo-600 text-lg">
                        €{formData.items.reduce((acc, item) => acc + Number(item.totalAmount || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
          </div>
        </section>

      </main>
    </div>
  );
}

