'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, FileImage, FileText, LoaderCircle, Plus, ScanText, Trash2, Upload, X } from 'lucide-react';

type DraftItem = {
  transfer_number: string;
  source_branch: string;
  destination_branch: string;
  expected_quantity: number;
  confidence: number;
  pageName: string;
  needsReview: boolean;
};
type ScannedPage = { id: string; file: File; preview: string; title: string };
type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const blankItem = (): DraftItem => ({ transfer_number: '', source_branch: '', destination_branch: '', expected_quantity: 1, confidence: 0, pageName: 'เพิ่มเอง', needsReview: true });

function parseTransferRows(text: string, pageName: string, confidence: number): DraftItem[] {
  const normalized = text.toUpperCase().replace(/[|¦]/g, ' | ').replace(/\r/g, '\n');
  const matches = [...normalized.matchAll(/\bT[F7]S\s*[-:]?\s*([A-Z0-9][A-Z0-9-]{5,39})\b/g)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? normalized.length;
    const segment = normalized.slice(start, end).slice(0, 240);
    const transfer_number = match[0].replace(/[\s:-]/g, '').replace(/^T7S/, 'TFS');
    const branches = [...segment.matchAll(/\b\d{1,3}[_-][A-Z0-9]{2,5}\b/g)];
    const source_branch = branches[0]?.[0]?.replace('-', '_') ?? '';
    const destination_branch = branches[1]?.[0]?.replace('-', '_') ?? '';
    const endOfBranch = branches[1] ? (branches[1].index ?? 0) + branches[1][0].length : match[0].length;
    const quantityMatches = [...segment.slice(endOfBranch).matchAll(/\b\d{1,4}\b/g)];
    const parsedQuantity = quantityMatches.length ? Number(quantityMatches[0]?.[0]) : 0;
    const hasQuantity = Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10000;
    const needsReview = confidence < 72 || !source_branch || !destination_branch || !hasQuantity;
    return {
      transfer_number,
      source_branch,
      destination_branch,
      expected_quantity: hasQuantity ? parsedQuantity : 1,
      confidence,
      pageName,
      needsReview,
    };
  });
}

export default function Receive() {
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pagesRef = useRef<ScannedPage[]>([]);
  pagesRef.current = pages;

  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    async function openCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้ กรุณาเลือกภาพจากเครื่องแทน');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'เปิดกล้องไม่สำเร็จ');
        setCameraOn(false);
      }
    }
    void openCamera();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; };
  }, [cameraOn]);

  useEffect(() => () => pagesRef.current.forEach(page => URL.revokeObjectURL(page.preview)), []);

  function appendPage(file: File, title = file.name) {
    const preview = URL.createObjectURL(file);
    setPages(current => [...current, { id: crypto.randomUUID(), file, preview, title }]);
  }

  async function pdfPages(file: File) {
    const pdfjs: PdfModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    if (pdf.numPages > 30) throw new Error(`${file.name} มี ${pdf.numPages} หน้า ระบบรับได้ไม่เกิน 30 หน้าต่อไฟล์`);
    const rendered: ScannedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setProgressLabel(`กำลังเตรียมหน้า ${pageNumber}/${pdf.numPages} · ${file.name}`);
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1600 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('เปิดพื้นที่อ่าน PDF ไม่สำเร็จ');
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('แปลงหน้า PDF ไม่สำเร็จ')), 'image/jpeg', 0.92));
      const image = new File([blob], `${file.name.replace(/\.pdf$/i, '')}-หน้า-${pageNumber}.jpg`, { type: 'image/jpeg' });
      rendered.push({ id: crypto.randomUUID(), file: image, preview: URL.createObjectURL(image), title: `${file.name} · หน้า ${pageNumber}` });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return rendered;
  }

  async function addFiles(files: FileList | File[]) {
    setError(''); setNotice('');
    const added: ScannedPage[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          added.push(...await pdfPages(file));
        } else if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          added.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), title: file.name });
        } else {
          setNotice(`ข้ามไฟล์ ${file.name}: รองรับ JPG, PNG, WebP และ PDF`);
        }
        if (pages.length + added.length > 30) throw new Error('รวมแล้วเกิน 30 หน้า กรุณาแบ่งสแกนเป็นหลายชุด เพื่อให้มือถือประมวลผลได้ลื่นไหล');
      }
      if (added.length) setPages(current => [...current, ...added]);
    } catch (cause) {
      added.forEach(page => URL.revokeObjectURL(page.preview));
      setError(cause instanceof Error ? cause.message : 'อ่านไฟล์ไม่สำเร็จ');
    }
  }

  async function capturePage() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) { setError('กล้องยังไม่พร้อม ลองอีกครั้ง'); return; }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1.6, 2200 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { setError('ถ่ายภาพไม่สำเร็จ'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) { setError('บันทึกภาพไม่สำเร็จ'); return; }
    appendPage(new File([blob], `ถ่ายเอกสาร-${new Date().toLocaleTimeString('th-TH').replaceAll(':', '-')}.jpg`, { type: 'image/jpeg' }), `ภาพถ่าย ${pages.length + 1}`);
    setNotice(`เพิ่มภาพแล้ว ${pages.length + 1} หน้า · ถ่ายหน้าถัดไปต่อได้เลย`);
    setError('');
  }

  function removePage(id: string) {
    const page = pages.find(item => item.id === id);
    if (page) URL.revokeObjectURL(page.preview);
    setPages(current => current.filter(item => item.id !== id));
  }

  async function runOcr() {
    if (!pages.length) return;
    setError(''); setNotice(''); setOcrBusy(true); setProgress(0); setItems([]);
    let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | undefined;
    try {
      const { createWorker } = await import('tesseract.js');
      let activePageIndex = 0;
      worker = await createWorker('eng', 1, { logger: message => {
        if (message.status === 'recognizing text' && typeof message.progress === 'number') {
          setProgress(value => Math.max(value, Math.min(99, Math.round(((activePageIndex + message.progress) / pages.length) * 100))));
        }
      } });
      const allRows: DraftItem[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        activePageIndex = index;
        const current = pages[index];
        setProgressLabel(`กำลังอ่านหน้า ${index + 1}/${pages.length}`);
        const { data } = await worker.recognize(current.file);
        setProgress(Math.round(((index + 1) / pages.length) * 100));
        allRows.push(...parseTransferRows(data.text, current.title, data.confidence));
      }
      setItems(allRows);
      if (allRows.length) setNotice(`อ่านพบ ${allRows.length} รายการจาก ${pages.length} หน้า · กรุณาตรวจตัวเลขและรายการที่แจ้งเตือนก่อนยืนยัน`);
      else setNotice('ยังอ่านเลข TFS ไม่พบ ลองถ่ายให้ตรงและชัดขึ้น หรือเพิ่มรายการด้วยปุ่มด้านล่าง');
    } catch (cause) {
      setError(cause instanceof Error ? `${cause.message} · ตรวจอินเทอร์เน็ตแล้วลองใหม่` : 'OCR ไม่สำเร็จ · ตรวจอินเทอร์เน็ตแล้วลองใหม่');
    } finally {
      await worker?.terminate();
      setOcrBusy(false);
      setProgressLabel('');
    }
  }

  function changeItem(index: number, key: keyof DraftItem, value: string) {
    setItems(current => current.map((item, i) => i === index ? {
      ...item,
      [key]: key === 'expected_quantity' ? Number(value) : key === 'transfer_number' ? value.toUpperCase() : value,
      needsReview: key === 'expected_quantity' ? !(Number.isInteger(Number(value)) && Number(value) >= 1) : item.needsReview,
    } : item));
  }

  const duplicates = items.filter((item, index) => items.findIndex(other => other.transfer_number.trim().toUpperCase() === item.transfer_number.trim().toUpperCase()) !== index);
  function mergeDuplicates() {
    const combined = new Map<string, DraftItem>();
    for (const item of items) {
      const key = item.transfer_number.trim().toUpperCase();
      const existing = combined.get(key);
      if (existing) combined.set(key, { ...existing, expected_quantity: existing.expected_quantity + item.expected_quantity, needsReview: existing.needsReview || item.needsReview });
      else combined.set(key, { ...item, transfer_number: key });
    }
    setItems([...combined.values()]);
    setNotice('รวมจำนวนของ TFS ที่ซ้ำกันแล้ว กรุณาตรวจสอบยอดอีกครั้ง');
  }

  async function createSession() {
    setError(''); setCreating(true);
    try {
      const payload = items.map(({ transfer_number, source_branch, destination_branch, expected_quantity }) => ({ transfer_number: transfer_number.trim().toUpperCase(), source_branch: source_branch.trim(), destination_branch: destination_branch.trim(), expected_quantity }));
      const response = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'สร้างรอบไม่สำเร็จ');
      location.href = `/session/${result.session.id}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างรอบไม่สำเร็จ');
      setCreating(false);
    }
  }

  const expectedTotal = items.reduce((sum, item) => sum + (Number.isInteger(item.expected_quantity) ? item.expected_quantity : 0), 0);
  const canCreate = items.length > 0 && !duplicates.length && items.every(item => /^TFS[A-Z0-9-]{5,40}$/.test(item.transfer_number.trim().toUpperCase()) && Number.isInteger(item.expected_quantity) && item.expected_quantity >= 1);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">BOXCHECK</Link>
        <nav className="nav" aria-label="เมนูหลัก"><Link href="/">ภาพรวม</Link><Link className="active" href="/receive">สร้างรอบตรวจรับ</Link><Link href="/history">ประวัติ</Link></nav>
      </header>

      <div className="page-kicker"><Link href="/" aria-label="กลับหน้าภาพรวม"><ArrowLeft size={15}/></Link><span>การตรวจรับสินค้า</span><ChevronRight size={13}/><span>สร้างรอบใหม่</span></div>
      <div className="split mobile-stack space">
        <div><h1 className="heading">สแกนใบโอนสินค้า</h1><p className="muted" style={{ margin: 0 }}>ถ่ายหลายหน้า หรือเลือกรูปและ PDF หลายไฟล์ แล้วให้ระบบอ่านรายการ TFS ให้</p></div>
        <div className="receive-steps"><div className="receive-step current"><span className="step-dot">01</span> เอกสาร</div><span className="step-line"/><div className={`receive-step ${items.length ? 'current' : ''}`}><span className="step-dot">02</span> ตรวจรายการ</div><span className="step-line"/><div className="receive-step"><span className="step-dot">03</span> เริ่มรับ</div></div>
      </div>

      <section className="card space">
        <div className="split mobile-stack"><div><h2 className="section-title">1. เพิ่มใบโอน</h2><p className="muted small" style={{ margin: '4px 0 0' }}>JPG, PNG, WebP หรือ PDF หลายหน้า · รวมไม่เกิน 30 หน้า</p></div>{pages.length > 0 && <span className="tag">{pages.length} หน้า</span>}</div>
        <div className="upload-panel space" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}>
          <div style={{ display: 'grid', placeItems: 'center', color: 'var(--green)', marginBottom: 9 }}><FileText size={27} strokeWidth={1.7}/></div>
          <strong>เพิ่มเอกสารใบโอน</strong>
          <div className="muted small" style={{ marginTop: 4 }}>ลากไฟล์มาวางที่นี่ หรือเลือกจากอุปกรณ์</div>
          <div className="upload-actions">
            <button className="button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16}/> เลือกรูป / PDF</button>
            <button className={`button ${cameraOn ? 'primary' : ''}`} type="button" onClick={() => { setError(''); setCameraOn(value => !value); }}><Camera size={16}/>{cameraOn ? 'ปิดกล้อง' : 'เปิดกล้องถ่ายเอกสาร'}</button>
          </div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple hidden onChange={event => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ''; }}/>
        </div>

        {cameraOn && <div className="camera-card space"><div className="scanner"><video ref={videoRef} autoPlay muted playsInline aria-label="ภาพจากกล้องถ่ายเอกสาร"/></div><div className="split mobile-stack space"><div><strong>จัดกระดาษให้เต็มกรอบ</strong><div className="muted small">ถ่ายเสร็จแล้วถ่ายหน้าถัดไปต่อได้เลย</div></div><button className="button primary" type="button" onClick={() => void capturePage()}><Camera size={16}/> ถ่ายเก็บหน้านี้</button></div></div>}

        {pages.length > 0 && <div className="space stack">
          <div className="split"><h3 className="section-title">ภาพเอกสารที่เลือก</h3><button className="button" type="button" onClick={() => { pages.forEach(page => URL.revokeObjectURL(page.preview)); setPages([]); setItems([]); setNotice(''); setError(''); }}>ล้างทั้งหมด</button></div>
          <div className="doc-grid">{pages.map((page, index) => <figure className="doc-thumb" key={page.id}><img src={page.preview} alt={`ตัวอย่างหน้า ${index + 1}`}/><button type="button" className="doc-remove" onClick={() => removePage(page.id)} aria-label={`ลบ ${page.title}`}><X size={15}/></button><figcaption title={page.title}>{String(index + 1).padStart(2, '0')} · {page.title}</figcaption></figure>)}</div>
          <button className="button primary" type="button" onClick={() => void runOcr()} disabled={ocrBusy}>{ocrBusy ? <><LoaderCircle size={16} className="spin"/> กำลังอ่านเอกสาร…</> : <><ScanText size={16}/> อ่านข้อมูลด้วย OCR {pages.length} หน้า</>}</button>
          {ocrBusy && <div className="stack"><div className="split small"><span>{progressLabel || 'กำลังเตรียมระบบอ่านข้อความ'}</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${Math.max(3, progress)}%` }}/></div></div>}
        </div>}
        {(notice || error) && <div className={error ? 'review-note' : 'status-line space'} role="status">{error ? error : <><Check size={15} color="var(--green)"/>{notice}</>}</div>}
        <p className="muted small" style={{ margin: '15px 0 0' }}>OCR ทำงานบนอุปกรณ์นี้ ภาพไม่ถูกส่งไปบริการ OCR ภายนอก · ครั้งแรกต้องเชื่อมอินเทอร์เน็ตเพื่อโหลดตัวอ่านข้อความ</p>
      </section>

      <section className="card space">
        <div className="split mobile-stack"><div><h2 className="section-title">2. ตรวจทานรายการที่อ่านได้</h2><p className="muted small" style={{ margin: '4px 0 0' }}>แก้ไขข้อมูลให้ถูกต้องก่อนสร้างรอบ ระบบยังไม่บันทึกข้อมูลจนกว่าจะกดยืนยัน</p></div><div className="tag">{items.length} รายการ · {expectedTotal} กล่อง</div></div>
        {duplicates.length > 0 && <div className="review-note space"><div className="split mobile-stack"><span>พบเลข TFS ซ้ำ: {Array.from(new Set(duplicates.map(item => item.transfer_number))).join(', ')} · เลือกว่าจะรวมจำนวนหรือแก้เลขรายการ</span><button className="button" type="button" onClick={mergeDuplicates}>รวม TFS ซ้ำ</button></div></div>}
        {items.length === 0 ? <div className="muted space">ยังไม่มีรายการที่อ่านได้ เพิ่มภาพแล้วกด “อ่านข้อมูลด้วย OCR” หรือเพิ่มรายการด้วยตนเองได้</div> : <div className="tablewrap space"><table><thead><tr><th>#</th><th>เลข TFS</th><th>ต้นทาง</th><th>ปลายทาง</th><th>กล่อง</th><th>อ่านจาก</th><th/></tr></thead><tbody>{items.map((item, index) => <tr key={`${index}-${item.pageName}`}>
          <td className="muted">{String(index + 1).padStart(2, '0')}{item.needsReview && <div className="confidence-low">ตรวจอีกครั้ง</div>}</td>
          <td><input className="table-input" aria-label={`เลข TFS แถว ${index + 1}`} value={item.transfer_number} onChange={event => changeItem(index, 'transfer_number', event.target.value)} placeholder="TFS260604867"/></td>
          <td><input className="table-input" aria-label={`ต้นทางแถว ${index + 1}`} value={item.source_branch} onChange={event => changeItem(index, 'source_branch', event.target.value)} placeholder="84_KPP"/></td>
          <td><input className="table-input" aria-label={`ปลายทางแถว ${index + 1}`} value={item.destination_branch} onChange={event => changeItem(index, 'destination_branch', event.target.value)} placeholder="93_LCR"/></td>
          <td><input className="quantity-input" aria-label={`จำนวนกล่องแถว ${index + 1}`} type="number" min="1" max="10000" value={item.expected_quantity} onChange={event => changeItem(index, 'expected_quantity', event.target.value)}/></td>
          <td className="muted small" title={item.pageName}>{item.pageName.slice(0, 16)}{item.confidence ? <div className="small">มั่นใจ {Math.round(item.confidence)}%</div> : null}</td>
          <td><button className="icon-button" type="button" aria-label={`ลบรายการ ${item.transfer_number}`} onClick={() => setItems(current => current.filter((_, i) => i !== index))}><Trash2 size={15}/></button></td>
        </tr>)}</tbody></table></div>}
        <div className="split mobile-stack space"><button className="button" type="button" onClick={() => setItems(current => [...current, blankItem()])}><Plus size={15}/> เพิ่มรายการเอง</button><strong>ยอดตามใบโอน {expectedTotal.toLocaleString('th-TH')} กล่อง</strong></div>
        {error && items.length > 0 && <p className="error small">{error}</p>}
        <div className="split mobile-stack space"><Link className="button" href="/"><ArrowLeft size={15}/> ย้อนกลับ</Link><button className="button primary" type="button" disabled={!canCreate || creating || ocrBusy} onClick={() => void createSession()}>{creating ? <><LoaderCircle size={16} className="spin"/> กำลังสร้างรอบ…</> : <>ตรวจแล้ว · สร้างรอบตรวจรับ <ChevronRight size={16}/></>}</button></div>
        {!canCreate && items.length > 0 && <div className="muted small" style={{ marginTop: 10, textAlign: 'right' }}>ตรวจเลข TFS, จำนวนกล่อง และรายการซ้ำให้เรียบร้อยก่อนเริ่มรับ</div>}
      </section>
      <style jsx>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.camera-card{border:1px solid var(--line);border-radius:13px;padding:12px;background:#f8f8f4}`}</style>
    </main>
  );
}
