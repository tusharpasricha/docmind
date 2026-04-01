'use client';

import { useState, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const STEPS = ['Extracting text', 'Chunking', 'Embedding', 'Storing'];

export default function FileUpload({
  apiUrl,
  onSuccess,
  isUploading,
  setIsUploading,
  uploadProgress,
  setUploadProgress,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const inputRef = useRef(null);

  const simulateSteps = () => {
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setCurrentStep(step);
      if (step >= STEPS.length) clearInterval(interval);
    }, 2000);
    return interval;
  };

  const handleFile = (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are accepted.');
      return;
    }
    setSelectedFile(file);
    setError(null);
    setSuccess(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);
    setSuccess(null);
    setCurrentStep(0);

    const stepInterval = simulateSteps();

    try {
      const formData = new FormData();
      formData.append('document', selectedFile);

      const res = await fetch(`${apiUrl}/api/documents/upload`, {
        method: 'POST',
        body: formData,
      });

      clearInterval(stepInterval);
      setCurrentStep(STEPS.length);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setSuccess(`${data.chunks} chunks indexed`);
      setSelectedFile(null);
      onSuccess(data);
    } catch (err) {
      clearInterval(stepInterval);
      setError(err.message);
    } finally {
      setIsUploading(false);
      setCurrentStep(0);
    }
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onClick={() => !isUploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`relative rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-blue-300 bg-white/15'
            : selectedFile
            ? 'border-green-400/50 bg-white/10'
            : 'border-white/20 hover:border-white/40 hover:bg-white/5'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        <Upload size={20} className="mx-auto mb-1 text-blue-200/60" />
        {selectedFile ? (
          <p className="text-xs text-green-300 font-medium truncate">{selectedFile.name}</p>
        ) : (
          <p className="text-xs text-blue-200/60">Drop PDF or click to browse</p>
        )}
      </div>

      {/* Upload progress */}
      {isUploading && (
        <div className="space-y-1.5">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex items-center gap-2 text-xs">
              {idx < currentStep ? (
                <CheckCircle size={12} className="text-green-400 flex-shrink-0" />
              ) : idx === currentStep ? (
                <Loader2 size={12} className="text-blue-300 animate-spin flex-shrink-0" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-white/20 flex-shrink-0" />
              )}
              <span
                className={
                  idx < currentStep
                    ? 'text-green-400/80'
                    : idx === currentStep
                    ? 'text-white'
                    : 'text-white/30'
                }
              >
                {step}...
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {selectedFile && !isUploading && (
        <button
          onClick={handleUpload}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: '#4472C4' }}
          onMouseOver={(e) => (e.target.style.backgroundColor = '#3461B3')}
          onMouseOut={(e) => (e.target.style.backgroundColor = '#4472C4')}
        >
          Index Document
        </button>
      )}

      {/* Success */}
      {success && (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <CheckCircle size={13} />
          <span>{success}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
