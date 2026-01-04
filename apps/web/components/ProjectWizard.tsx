import React, { useState } from 'react';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-xl shadow-2xl p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">New Project Configuration</h2>
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className={`h-1 flex-1 rounded-full ${step >= i ? 'bg-brand-500' : 'bg-slate-800'}`} />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4 animate-fadeIn">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Project Name</label>
              <input 
                type="text" 
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="My Awesome Site"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Domain</label>
              <input 
                type="text" 
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="example.com"
                value={formData.domain}
                onChange={e => setFormData({...formData, domain: e.target.value})}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-fadeIn">
             <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Sitemap Index URL</label>
              <input 
                type="text" 
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="https://example.com/sitemap_index.xml"
                value={formData.sitemapUrl}
                onChange={e => setFormData({...formData, sitemapUrl: e.target.value})}
              />
              <p className="text-xs text-slate-500 mt-1">We will recursively discover all child sitemaps.</p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-fadeIn">
             <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Google Service Account (JSON)</label>
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 text-center hover:border-brand-500 transition-colors cursor-pointer">
                <input type="file" className="hidden" id="json-upload" onChange={e => setFormData({...formData, gscKey: e.target.files?.[0] || null})} />
                <label htmlFor="json-upload" className="cursor-pointer">
                  <div className="text-slate-300 font-medium">Click to upload JSON</div>
                  <div className="text-xs text-slate-500">{formData.gscKey ? formData.gscKey.name : 'Required for Google Indexing API'}</div>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">IndexNow Key</label>
              <input 
                type="text" 
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="Format: 32-character hex key"
                value={formData.indexNowKey}
                onChange={e => setFormData({...formData, indexNowKey: e.target.value})}
              />
            </div>
          </div>
        )}

        <div className="flex justify-between mt-8 pt-4 border-t border-slate-800">
          <button 
            onClick={step === 1 ? onCancel : handleBack}
            className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button 
            onClick={step === 3 ? () => onSubmit(formData) : handleNext}
            className="px-6 py-2 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors shadow-lg shadow-brand-500/20"
          >
            {step === 3 ? 'Create Project' : 'Next Step'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectWizard;