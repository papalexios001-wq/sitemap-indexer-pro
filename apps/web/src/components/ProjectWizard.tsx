import React, { useState } from 'react';
import { X, Upload, Check, ChevronRight, ChevronLeft, RefreshCw, Download, FileText } from 'lucide-react';

interface ProjectWizardProps {
  onCancel: () => void;
  onSubmit: (data: any) => void;
}

const ProjectWizard: React.FC<ProjectWizardProps> = ({ onCancel, onSubmit }) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    sitemapUrl: '',
    gscKey: null as File | null,
    indexNowKey: ''
  });

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  // 🛡️ AUTO-GENERATE VALID KEY
  const generateIndexNowKey = () => {
    // Generate 32 char random hex string
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    setFormData(prev => ({ ...prev, indexNowKey: key }));
  };

  // ⬇️ DOWNLOAD VERIFICATION FILE
  const downloadKeyFile = () => {
    if (!formData.indexNowKey) return;
    const element = document.createElement("a");
    const file = new Blob([formData.indexNowKey], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `${formData.indexNowKey}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" 
        onClick={onCancel}
      />
      
      {/* Modal */}
      <div className="glass-modal w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-slide-up relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-start bg-white/5">
           <div>
             <h2 className="text-xl font-semibold text-white">Create New Project</h2>
             <p className="text-sm text-zinc-400 mt-1">Configure indexing parameters for your domain.</p>
           </div>
           <button onClick={onCancel} className="text-zinc-500 hover:text-white transition-colors">
             <X className="w-5 h-5" />
           </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1 bg-zinc-800">
          <div 
            className="h-full bg-brand-500 transition-all duration-300 ease-out" 
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-8 flex-1 overflow-y-auto">
          {step === 1 && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Project Name</label>
                <input 
                  type="text" 
                  autoFocus
                  className="w-full bg-zinc-900/50 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 outline-none transition-all placeholder-zinc-600"
                  placeholder="e.g. Marketing Site Production"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Domain</label>
                <div className="relative">
                   <span className="absolute left-4 top-3.5 text-zinc-500 text-sm">https://</span>
                   <input 
                    type="text" 
                    className="w-full bg-zinc-900/50 border border-zinc-700 rounded-lg pl-16 pr-4 py-3 text-white focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 outline-none transition-all placeholder-zinc-600 font-mono text-sm"
                    placeholder="example.com"
                    value={formData.domain}
                    onChange={e => setFormData({...formData, domain: e.target.value})}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
               <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Sitemap Index URL</label>
                <input 
                  type="text" 
                  className="w-full bg-zinc-900/50 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 outline-none transition-all placeholder-zinc-600 font-mono text-sm"
                  placeholder="https://example.com/sitemap_index.xml"
                  value={formData.sitemapUrl}
                  onChange={e => setFormData({...formData, sitemapUrl: e.target.value})}
                />
                <p className="text-xs text-zinc-500 flex items-center gap-1.5 mt-2 bg-blue-500/10 text-blue-400 p-2 rounded border border-blue-500/20">
                  <Check className="w-3 h-3" /> System will recursively parse all child sitemaps found in the index.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-fade-in">
               <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Google Service Account</label>
                <div className="border border-dashed border-zinc-700 rounded-xl p-6 text-center hover:border-brand-500/50 hover:bg-zinc-800/30 transition-all cursor-pointer group">
                  <input type="file" className="hidden" id="json-upload" onChange={e => setFormData({...formData, gscKey: e.target.files?.[0] || null})} />
                  <label htmlFor="json-upload" className="cursor-pointer flex flex-col items-center">
                    <div className="p-3 bg-zinc-800 rounded-full mb-3 group-hover:scale-110 transition-transform">
                      <Upload className="w-5 h-5 text-zinc-400 group-hover:text-brand-400" />
                    </div>
                    <div className="text-zinc-300 font-medium">Upload JSON Key</div>
                    <div className="text-xs text-zinc-500 mt-1">{formData.gscKey ? <span className="text-emerald-400 font-mono">{formData.gscKey.name}</span> : 'Required for Google Indexing API'}</div>
                  </label>
                </div>
              </div>
              
              {/* INDEXNOW SECTION */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                   <label className="text-sm font-medium text-zinc-300">IndexNow API Key</label>
                   <button 
                     onClick={generateIndexNowKey}
                     className="text-xs flex items-center gap-1 text-brand-400 hover:text-brand-300 transition-colors"
                   >
                     <RefreshCw className="w-3 h-3" /> Generate Random Key
                   </button>
                </div>
                <div className="flex gap-2">
                   <input 
                    type="text" 
                    className="flex-1 bg-zinc-900/50 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 outline-none transition-all placeholder-zinc-600 font-mono text-sm"
                    placeholder="Click Generate or paste existing..."
                    value={formData.indexNowKey}
                    onChange={e => setFormData({...formData, indexNowKey: e.target.value})}
                  />
                  {formData.indexNowKey && (
                    <button 
                      onClick={downloadKeyFile}
                      className="px-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg border border-zinc-700 transition-colors flex items-center justify-center tooltip"
                      title="Download Verification File"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  )}
                </div>
                {formData.indexNowKey && (
                  <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 text-xs text-zinc-400 flex gap-3 items-start">
                     <FileText className="w-4 h-4 mt-0.5 shrink-0 text-brand-500" />
                     <div>
                       <span className="text-zinc-200 font-medium block mb-1">Verification Required</span>
                       To verify ownership, download the file above and upload it to the root of your domain:
                       <br />
                       <code className="text-brand-400 bg-brand-900/20 px-1 rounded mt-1 inline-block">https://{formData.domain || 'yourdomain.com'}/{formData.indexNowKey}.txt</code>
                     </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 flex justify-between bg-zinc-900/50">
          <button 
            onClick={step === 1 ? onCancel : handleBack}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-2"
          >
            {step > 1 && <ChevronLeft className="w-4 h-4" />}
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button 
            onClick={step === 3 ? () => onSubmit(formData) : handleNext}
            className="px-6 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-brand-500/20 flex items-center gap-2"
          >
            {step === 3 ? 'Create Project' : 'Continue'}
            {step < 3 && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectWizard;