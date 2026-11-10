'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, FileImage, FileText, LoaderCircle, Plus, ScanText, Trash2, Upload, X } from 'lucide-react';
import { detectTableRows, rowHasMarginHandwriting, rowHasStrikeThrough, validateEveandboyRow, validateEveandboyTotals, EVEANDBOY_TEMPLATE } from '@/lib/ocr/eveandboy.mjs';
import { estimateSkewAngle } from '@/lib/ocr/deskew.mjs';
import { normalizeDocumentPage } from '@/lib/ocr/normalize-page';
import { MobileNav } from '@/app/mobile-nav';
import { createClient as createSupabaseBrowserClient } from '@/lib/supabase/client';

type DraftItem = {
  transfer_number: string;
  source_branch: string;
  destination_branch: string;
  expected_quantity: number | null;
  confidence: number;
  pageName: string;
  rowNumber: number;
  rawText: string;
  pageNumber: number;
  needsReview: boolean;
  sequenceNumber: number | null;
  geometryValid: boolean;
  flags: string[];
  userDecision: 'UNDECIDED' | 'INCLUDE' | 'EXCLUDE';
  rowCrop: string;
  tfsCrop: string;
  quantityCrop: string;
  sourceCrop: string;
  destinationCrop: string;
  highlight: { top: number; height: number };
};
type ScannedPage = { id: string; file: File; preview: string; title: string };
type OriginalDocument = { id: string; file: File; title: string };
type RawOcrPage = { pageName: string; rawText: string; confidence: number; preview: string; documentNumber: string; documentDate: string; printedTotal: number | null; detectedRowCount: number; geometryValid: boolean };
type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const blankItem = (): DraftItem => ({ transfer_number: '', source_branch: '', destination_branch: '', expected_quantity: null, confidence: 0, pageName: 'เพิ่มเอง', rowNumber: 0, rawText: '', pageNumber: 0, needsReview: true, sequenceNumber: null, geometryValid: false, flags: [], userDecision: 'INCLUDE', rowCrop: '', tfsCrop: '', quantityCrop: '', sourceCrop: '', destinationCrop: '', highlight: { top: 0, height: 0 } });

async function cropCanvas(source: HTMLCanvasElement, left: number, top: number, right: number, bottom: number) {
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top));
  const sourceWidth = Math.max(1, Math.ceil(right) - x), sourceHeight = Math.max(1, Math.ceil(bottom) - y);
  const scale = 2.4;
  const canvas = document.createElement('canvas'); canvas.width = Math.round(sourceWidth * scale); canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('ตัดภาพแต่ละช่องไม่สำเร็จ');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.25)';
  context.drawImage(source, x, y, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('จัดเก็บภาพช่อง OCR ไม่สำเร็จ')), 'image/jpeg', 0.86));
  const image = new File([blob], 'cell.jpg', { type: 'image/jpeg' });
  const preview = canvas.toDataURL('image/jpeg', 0.72);
  canvas.width = 0; canvas.height = 0;
  return { image, preview };
}

function grayscale(image: ImageData) {
  const result = new Uint8Array(image.width * image.height);
  for (let i = 0; i < result.length; i += 1) {
    const p = i * 4; result[i] = Math.round(image.data[p] * 0.299 + image.data[p + 1] * 0.587 + image.data[p + 2] * 0.114);
  }
  return result;
}

function cellBounds(canvas: HTMLCanvasElement, column: readonly number[], y0: number, y1: number) {
  const marginX = canvas.width * 0.0025;
  const marginY = Math.max(2, (y1 - y0) * 0.12);
  return [canvas.width * column[0] + marginX, y0 + marginY, canvas.width * column[1] - marginX, y1 - marginY] as const;
}

export default function Receive() {
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [rawOcrPages, setRawOcrPages] = useState<RawOcrPage[]>([]);
  const [originalDocuments, setOriginalDocuments] = useState<OriginalDocument[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [createdSessionId, setCreatedSessionId] = useState('');
  const [selectedReviewRow, setSelectedReviewRow] = useState(0);
  const [totalAcknowledged, setTotalAcknowledged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
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
        const cameraError = cause instanceof DOMException ? cause.name : '';
        if (!window.isSecureContext) setError('กล้องสดต้องเปิดเว็บไซต์ผ่าน HTTPS กรุณาใช้ URL ของ Vercel ที่ขึ้นต้นด้วย https://');
        else if (cameraError === 'NotAllowedError' || cameraError === 'PermissionDeniedError') setError('เบราว์เซอร์ยังไม่อนุญาตใช้กล้อง กดไอคอนข้าง URL แล้วเปลี่ยน Camera เป็น Allow หรือใช้ปุ่มถ่ายภาพจากอุปกรณ์');
        else if (cameraError === 'NotFoundError' || cameraError === 'DevicesNotFoundError') setError('ไม่พบกล้องในอุปกรณ์ ใช้ปุ่มถ่ายภาพจากอุปกรณ์หรือเลือกรูปแทน');
        else setError(cause instanceof Error ? cause.message : 'เปิดกล้องไม่สำเร็จ ใช้ปุ่มถ่ายภาพจากอุปกรณ์แทนได้');
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
    const originals: OriginalDocument[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const rendered = await pdfPages(file);
          added.push(...rendered);
          originals.push({ id: crypto.randomUUID(), file, title: file.name });
        } else if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          added.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), title: file.name });
          originals.push({ id: crypto.randomUUID(), file, title: file.name });
        } else {
          setNotice(`ข้ามไฟล์ ${file.name}: รองรับ JPG, PNG, WebP และ PDF`);
        }
        if (pages.length + added.length > 30) throw new Error('รวมแล้วเกิน 30 หน้า กรุณาแบ่งสแกนเป็นหลายชุด เพื่อให้มือถือประมวลผลได้ลื่นไหล');
      }
      if (added.length) setPages(current => [...current, ...added]);
      if (originals.length) setOriginalDocuments(current => [...current, ...originals]);
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
    const file = new File([blob], `ถ่ายเอกสาร-${new Date().toLocaleTimeString('th-TH').replaceAll(':', '-')}.jpg`, { type: 'image/jpeg' });
    const title = `ภาพถ่าย ${pages.length + 1}`;
    appendPage(file, title);
    setOriginalDocuments(current => [...current, { id: crypto.randomUUID(), file, title }]);
    setNotice(`เพิ่มภาพแล้ว ${pages.length + 1} หน้า · ถ่ายหน้าถัดไปต่อได้เลย`);
    setError('');
  }

  async function prepareOcrImage(file: File) {
    const bitmap = await createImageBitmap(file);
    const imageScale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const imageWidth = Math.max(32, Math.round(bitmap.width * imageScale));
    const imageHeight = Math.max(32, Math.round(bitmap.height * imageScale));
    const sample = document.createElement('canvas');
    const sampleScale = Math.min(1, 900 / imageWidth);
    sample.width = Math.max(32, Math.round(imageWidth * sampleScale));
    sample.height = Math.max(32, Math.round(imageHeight * sampleScale));
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    if (!sampleContext) { bitmap.close(); throw new Error('เตรียมภาพสำหรับ OCR ไม่สำเร็จ'); }
    sampleContext.filter = 'grayscale(1) contrast(1.16)';
    sampleContext.drawImage(bitmap, 0, 0, sample.width, sample.height);
    const skew = estimateSkewAngle(sampleContext.getImageData(0, 0, sample.width, sample.height), sample.width, sample.height);
    sample.width = 0;
    sample.height = 0;
    const radians = skew * Math.PI / 180;
    const outputWidth = Math.ceil(Math.abs(imageWidth * Math.cos(radians)) + Math.abs(imageHeight * Math.sin(radians)));
    const outputHeight = Math.ceil(Math.abs(imageHeight * Math.cos(radians)) + Math.abs(imageWidth * Math.sin(radians)));
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); throw new Error('หมุนแก้ความเอียงของภาพไม่สำเร็จ'); }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.filter = 'grayscale(1) contrast(1.16)';
    context.translate(outputWidth / 2, outputHeight / 2);
    context.rotate(-radians);
    context.drawImage(bitmap, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
    bitmap.close();
    if (outputWidth > 2 && outputHeight > 2) {
      const pixels = context.getImageData(0, 0, outputWidth, outputHeight);
      const source = pixels.data;
      const sharpened = new Uint8ClampedArray(source);
      const amount = 0.12;
      for (let y = 1; y < outputHeight - 1; y += 1) {
        for (let x = 1; x < outputWidth - 1; x += 1) {
          const i = (y * outputWidth + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const neighbors = source[i - outputWidth * 4 + channel] + source[i + outputWidth * 4 + channel] + source[i - 4 + channel] + source[i + 4 + channel];
            sharpened[i + channel] = source[i + channel] * (1 + amount * 4) - neighbors * amount;
          }
        }
      }
      pixels.data.set(sharpened);
      context.putImageData(pixels, 0, 0);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('ปรับภาพเอกสารไม่สำเร็จ')), 'image/jpeg', 0.94));
    canvas.width = 0;
    canvas.height = 0;
    return { file: new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }), width: outputWidth, height: outputHeight };
  }

  function removePage(id: string) {
    const page = pages.find(item => item.id === id);
    if (page) URL.revokeObjectURL(page.preview);
    setPages(current => current.filter(item => item.id !== id));
    if (page) {
      setItems(current => current.filter(item => item.pageName !== page.title));
      setRawOcrPages(current => current.filter(item => item.pageName !== page.title));
      setOriginalDocuments(current => current.filter(item => item.title !== page.title));
    }
  }

  async function runOcr() {
    if (!pages.length) return;
    setError(''); setNotice(''); setOcrBusy(true); setProgress(0); setItems([]); setTotalAcknowledged(false);
    setRawOcrPages([]);
    let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | undefined;
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('eng+tha', 1);
      const readCell = async (source: HTMLCanvasElement, coords: readonly number[], whitelist: string) => {
        const crop = await cropCanvas(source, coords[0], coords[1], coords[2], coords[3]);
        await worker!.setParameters({ tessedit_pageseg_mode: 7 as never, tessedit_char_whitelist: whitelist, user_defined_dpi: '300' });
        const result = await worker!.recognize(crop.image, { rotateAuto: false }, { text: true });
        return { value: String(result.data.text ?? '').trim().replace(/\s+/g, ''), confidence: Math.max(0, Number(result.data.confidence) || 0), preview: crop.preview };
      };
      const allRows: DraftItem[] = [];
      const rawPages: RawOcrPage[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const current = pages[index];
        setProgressLabel(`ตรวจขอบกระดาษและแก้ภาพเอียง · หน้า ${index + 1}/${pages.length}`);
        const normalized = await normalizeDocumentPage(current.file);
        const prepared = await prepareOcrImage(normalized.file);
        const bitmap = await createImageBitmap(prepared.file);
        const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = bitmap.width; sourceCanvas.height = bitmap.height;
        const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
        if (!sourceContext) { bitmap.close(); throw new Error('เตรียมภาพที่ปรับมุมแล้วไม่สำเร็จ'); }
        sourceContext.drawImage(bitmap, 0, 0); bitmap.close();
        const gray = grayscale(sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height));
        const grid = detectTableRows(gray, sourceCanvas.width, sourceCanvas.height);
        const rowsFound = Math.max(0, grid.boundaries.length - 1);
        const pagePreview = sourceCanvas.toDataURL('image/jpeg', 0.86);
        const docNumber = await readCell(sourceCanvas, [sourceCanvas.width * 0.17, sourceCanvas.height * 0.062, sourceCanvas.width * 0.405, sourceCanvas.height * 0.094], 'CTRL0123456789');
        const docDate = await readCell(sourceCanvas, [sourceCanvas.width * 0.43, sourceCanvas.height * 0.066, sourceCanvas.width * 0.57, sourceCanvas.height * 0.097], '0123456789/.-');
        const footer = await readCell(sourceCanvas, [sourceCanvas.width * 0.81, sourceCanvas.height * 0.482, sourceCanvas.width * 0.906, sourceCanvas.height * 0.506], '0123456789');
        const parsedTotal = footer.value.match(/\d{1,5}/)?.[0];
        const printedTotal = parsedTotal ? Number(parsedTotal) : null;
        const templateAnchorValid = /^CTRL\d{11}$/i.test(docNumber.value) && /^\d{2}[/.\-]\d{2}[/.\-]\d{4}$/.test(docDate.value);
        let pageConfidenceTotal = docNumber.confidence + docDate.confidence + footer.confidence;
        const pageRows: DraftItem[] = [];
        for (let rowIndex = 0; rowIndex < rowsFound; rowIndex += 1) {
          const y0 = grid.boundaries[rowIndex], y1 = grid.boundaries[rowIndex + 1];
          const rowCropBounds = [sourceCanvas.width * EVEANDBOY_TEMPLATE.table.left, y0, sourceCanvas.width * EVEANDBOY_TEMPLATE.table.right, y1] as const;
          const rowCrop = await cropCanvas(sourceCanvas, ...rowCropBounds);
          const sequence = await readCell(sourceCanvas, cellBounds(sourceCanvas, EVEANDBOY_TEMPLATE.columns.sequence, y0, y1), '0123456789');
          const tfs = await readCell(sourceCanvas, cellBounds(sourceCanvas, EVEANDBOY_TEMPLATE.columns.tfs, y0, y1), 'TFS0123456789');
          const source = await readCell(sourceCanvas, cellBounds(sourceCanvas, EVEANDBOY_TEMPLATE.columns.source, y0, y1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_');
          const destination = await readCell(sourceCanvas, cellBounds(sourceCanvas, EVEANDBOY_TEMPLATE.columns.destination, y0, y1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_');
          const quantity = await readCell(sourceCanvas, cellBounds(sourceCanvas, EVEANDBOY_TEMPLATE.columns.quantity, y0, y1), '0123456789');
          const seq = sequence.value.match(/\d{1,3}/)?.[0];
          const qty = quantity.value.match(/\d{1,5}/)?.[0];
          const flags: string[] = [];
          if (rowHasStrikeThrough(gray, sourceCanvas.width, sourceCanvas.height, y0, y1)) flags.push('CROSSED_OUT');
          if (rowHasMarginHandwriting(gray, sourceCanvas.width, sourceCanvas.height, y0, y1)) flags.push('HANDWRITING_DETECTED');
          if (!grid.geometryValid || !normalized.pageBoundsFound || !templateAnchorValid || Number(seq) !== rowIndex + 1) flags.push('NEEDS_REVIEW');
          const confidence = Math.round((sequence.confidence + tfs.confidence + source.confidence + destination.confidence + quantity.confidence) / 5);
          const candidate: DraftItem = {
            transfer_number: tfs.value.toUpperCase(), source_branch: source.value.toUpperCase(), destination_branch: destination.value.toUpperCase(),
            expected_quantity: qty === undefined ? null : Number(qty), confidence, pageName: current.title, rowNumber: rowIndex + 1,
            rawText: [sequence.value, tfs.value, source.value, destination.value, quantity.value].join(' | '), pageNumber: index + 1,
            needsReview: true, sequenceNumber: seq ? Number(seq) : null, geometryValid: grid.geometryValid && normalized.pageBoundsFound && templateAnchorValid,
            flags, userDecision: flags.length ? 'UNDECIDED' : 'INCLUDE', rowCrop: rowCrop.preview, tfsCrop: tfs.preview,
            quantityCrop: quantity.preview, sourceCrop: source.preview, destinationCrop: destination.preview,
            highlight: { top: y0 / sourceCanvas.height * 100, height: (y1 - y0) / sourceCanvas.height * 100 },
          };
          // Keep OCR values verbatim. Validation is advisory; it never substitutes ambiguous glyphs.
          validateEveandboyRow(candidate);
          pageRows.push(candidate);
          pageConfidenceTotal += confidence;
          setProgress(Math.round(((index + (rowIndex + 1) / Math.max(1, rowsFound)) / pages.length) * 100));
          setProgressLabel(`อ่านช่องแยก · หน้า ${index + 1}/${pages.length} · แถว ${rowIndex + 1}/${rowsFound}`);
        }
        const page = { pageName: current.title, rawText: pageRows.map(row => row.rawText).join('\n'), confidence: Math.round(pageConfidenceTotal / Math.max(1, pageRows.length + 3)), preview: pagePreview, documentNumber: docNumber.value, documentDate: docDate.value, printedTotal, detectedRowCount: rowsFound, geometryValid: grid.geometryValid && normalized.pageBoundsFound && templateAnchorValid };
        rawPages.push(page);
        allRows.push(...pageRows);
        sourceCanvas.width = 0; sourceCanvas.height = 0;
      }
      setItems(allRows);
      setRawOcrPages(rawPages);
      setSelectedReviewRow(0);
      if (allRows.length) setNotice(`ตรวจพบ ${allRows.length} แถวจากตาราง EVEANDBOY · อ่านแยกทีละช่องแล้ว · แถวที่มีเครื่องหมายหรือรูปทรงไม่ชัดต้องตัดสินใจเอง`);
      else setNotice('ตรวจไม่พบเส้นแบ่งแถวที่ชัดพอ จึงยังไม่สร้างรายการอัตโนมัติ กรุณาถ่ายภาพให้เห็นตารางเต็มใบ');
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
      [key]: key === 'expected_quantity' || key === 'sequenceNumber' ? (value === '' ? null : Number(value)) : key === 'transfer_number' ? value.toUpperCase() : value,
      needsReview: true,
    } : item));
  }

  function confirmItem(index: number) {
    const item = items[index];
    if (!item || (item.flags.length > 0 && item.userDecision === 'UNDECIDED')) return;
    if (item.userDecision !== 'EXCLUDE' && (!EVEANDBOY_TEMPLATE.expectedTfsPattern.test(item.transfer_number.trim().toUpperCase()) || !EVEANDBOY_TEMPLATE.expectedBranchPattern.test(item.source_branch.trim().toUpperCase()) || !EVEANDBOY_TEMPLATE.expectedBranchPattern.test(item.destination_branch.trim().toUpperCase()) || !Number.isInteger(item.expected_quantity) || item.expected_quantity! < 0 || item.expected_quantity! > 100000)) return;
    setItems(current => current.map((row, i) => i === index ? { ...row, needsReview: false } : row));
  }

  function decideRow(index: number, decision: 'INCLUDE' | 'EXCLUDE') {
    setItems(current => current.map((row, i) => i === index ? { ...row, userDecision: decision, needsReview: true } : row));
  }

  const includedItems = items.filter(item => item.userDecision !== 'EXCLUDE');
  const duplicates = includedItems.filter((item, index) => includedItems.findIndex(other => other.transfer_number.trim().toUpperCase() === item.transfer_number.trim().toUpperCase()) !== index);
  function mergeDuplicates() {
    const combined = new Map<string, DraftItem>();
    for (const item of items) {
      const key = item.transfer_number.trim().toUpperCase();
      const existing = combined.get(key);
      if (existing) combined.set(key, { ...existing, expected_quantity: (existing.expected_quantity ?? 0) + (item.expected_quantity ?? 0), needsReview: true });
      else combined.set(key, { ...item, transfer_number: key });
    }
    setItems([...combined.values()]);
    setNotice('รวมจำนวนของ TFS ที่ซ้ำกันแล้ว กรุณาตรวจสอบยอดอีกครั้ง');
  }

  async function uploadDocumentsAndOpen(sessionId: string) {
    if (!originalDocuments.length) { location.href = `/session/${sessionId}`; return; }
    const supabase = createSupabaseBrowserClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง');
    for (const [index, document] of originalDocuments.entries()) {
      const filename = document.file.name.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
      const documentType = document.file.type || (filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(documentType)) throw new Error(`ชนิดไฟล์ ${filename} ไม่รองรับ`);
      if (document.file.size < 1 || document.file.size > 15 * 1024 * 1024) throw new Error(`ไฟล์ ${filename} ต้องมีขนาดไม่เกิน 15 MB`);
      const path = `${user.id}/${sessionId}/${document.id}_${filename}`;
      const folder = `${user.id}/${sessionId}`;
      const { data: existing, error: listError } = await supabase.storage.from('receiving-documents').list(folder, { search: `${document.id}_` });
      if (listError) throw new Error(`ตรวจพื้นที่จัดเก็บของ ${filename} ไม่สำเร็จ`);
      if (!existing?.some(entry => entry.name === `${document.id}_${filename}`)) {
        setNotice(`กำลังจัดเก็บเอกสาร ${index + 1}/${originalDocuments.length} · ${filename}`);
        const { error: uploadError } = await supabase.storage.from('receiving-documents').upload(path, document.file, { contentType: documentType, upsert: false });
        if (uploadError) throw new Error(`จัดเก็บ ${filename} ไม่สำเร็จ: ${uploadError.message}`);
      }
      const belongs = (pageName: string) => pageName === document.title || pageName.startsWith(`${document.title} ·`);
      const reviewedItems = items.filter(item => belongs(item.pageName)).map(item => ({ pageName: item.pageName, rowNumber: item.rowNumber, sequenceNumber: item.sequenceNumber, rawText: item.rawText, transfer_number: item.transfer_number, source_branch: item.source_branch, destination_branch: item.destination_branch, expected_quantity: item.expected_quantity, confidence: item.confidence, flags: item.flags, userDecision: item.userDecision, userVerified: !item.needsReview, geometryValid: item.geometryValid, evidence: { rowCrop: item.rowCrop, tfsCrop: item.tfsCrop, sourceCrop: item.sourceCrop, destinationCrop: item.destinationCrop, quantityCrop: item.quantityCrop, highlight: item.highlight } }));
      const documentPages = rawOcrPages.filter(page => belongs(page.pageName));
      const ocrAuditText = documentPages.map(page => `เลขใบนำส่ง: ${page.documentNumber || 'อ่านไม่ได้'} | วันที่: ${page.documentDate || 'อ่านไม่ได้'} | แถว: ${page.detectedRowCount} | ยอดท้ายใบ: ${page.printedTotal ?? 'อ่านไม่ได้'} | geometry: ${page.geometryValid ? 'VALID' : 'NEEDS_REVIEW'}\n${page.rawText}`).join('\n\n').slice(0, 100000);
      const metadata = { document_id: document.id, original_file_path: path, original_filename: filename, document_type: documentType, ocr_raw_text: ocrAuditText, reviewed_items: reviewedItems };
      const response = await fetch(`/api/sessions/${sessionId}/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documents: [metadata] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `บันทึกข้อมูล ${filename} ไม่สำเร็จ`);
    }
    location.href = `/session/${sessionId}`;
  }

  async function createSession() {
    setError(''); setCreating(true);
    try {
      const payload = includedItems.map(item => ({ transfer_number: item.transfer_number.trim().toUpperCase(), source_branch: item.source_branch.trim(), destination_branch: item.destination_branch.trim(), expected_quantity: item.expected_quantity, source_page_number: item.pageNumber, source_row_number: item.rowNumber, ocr_raw_text: item.rawText, ocr_confidence: item.confidence, ocr_status: item.rawText ? 'REVIEWED' : 'MANUAL' }));
      const response = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'สร้างรอบไม่สำเร็จ');
      setCreatedSessionId(result.session.id);
      await uploadDocumentsAndOpen(result.session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างรอบไม่สำเร็จ');
      setCreating(false);
    }
  }

  const expectedTotal = includedItems.reduce((sum, item) => sum + (Number.isInteger(item.expected_quantity) ? item.expected_quantity! : 0), 0);
  const printedTotal = rawOcrPages.length > 0 && rawOcrPages.every(page => Number.isInteger(page.printedTotal))
    ? rawOcrPages.reduce((sum, page) => sum + (page.printedTotal ?? 0), 0) : null;
  const totalValidation = validateEveandboyTotals(items, printedTotal);
  const selectedTotalValidation = validateEveandboyTotals(includedItems, printedTotal);
  const totalNeedsAck = rawOcrPages.length > 0 && (totalValidation.discrepancy || selectedTotalValidation.discrepancy);
  const canCreate = includedItems.length > 0 && !duplicates.length
    && items.every(item => item.userDecision === 'EXCLUDE' || (EVEANDBOY_TEMPLATE.expectedTfsPattern.test(item.transfer_number.trim().toUpperCase()) && EVEANDBOY_TEMPLATE.expectedBranchPattern.test(item.source_branch.trim().toUpperCase()) && EVEANDBOY_TEMPLATE.expectedBranchPattern.test(item.destination_branch.trim().toUpperCase()) && Number.isInteger(item.expected_quantity) && item.expected_quantity! >= 0 && item.expected_quantity! <= 100000 && !item.needsReview && (!item.flags.length || item.userDecision !== 'UNDECIDED')))
    && (!totalNeedsAck || totalAcknowledged);
  const activeItem = items[selectedReviewRow];
  const activePage = activeItem ? rawOcrPages.find(page => page.pageName === activeItem.pageName) : undefined;

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
            <button className="button primary" type="button" onClick={() => { setError(''); cameraInputRef.current?.click(); }}><Camera size={16}/> ถ่ายภาพหน้าเอกสาร</button>
            <button className="button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16}/> เลือกรูป / PDF</button>
            <button className={`button ${cameraOn ? 'primary' : ''}`} type="button" onClick={() => { setError(''); setCameraOn(value => !value); }}><ScanText size={16}/>{cameraOn ? 'ปิดกล้องสด' : 'เปิดกล้องสด'}</button>
          </div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple hidden onChange={event => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ''; }}/>
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={event => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ''; }}/>
        </div>

        {cameraOn && <div className="camera-card space"><div className="scanner"><video ref={videoRef} autoPlay muted playsInline aria-label="ภาพจากกล้องถ่ายเอกสาร"/><span className="camera-hint">จัดกระดาษให้อยู่ในกรอบแล้วถ่ายภาพ</span></div><div className="split mobile-stack space"><div><strong>กล้องสด</strong><div className="muted small">ถ่ายเสร็จแล้วถ่ายหน้าถัดไปต่อได้เลย</div></div><div className="row"><button className="button" type="button" onClick={() => cameraInputRef.current?.click()}><Camera size={16}/> ใช้กล้องของอุปกรณ์</button><button className="button primary" type="button" onClick={() => void capturePage()}><Camera size={16}/> ถ่ายจากภาพสด</button></div></div></div>}

        {pages.length > 0 && <div className="space stack">
          <div className="split"><h3 className="section-title">ภาพเอกสารที่เลือก</h3><button className="button" type="button" onClick={() => { pages.forEach(page => URL.revokeObjectURL(page.preview)); setPages([]); setItems([]); setRawOcrPages([]); setOriginalDocuments([]); setNotice(''); setError(''); }}>ล้างทั้งหมด</button></div>
          <div className="doc-grid">{pages.map((page, index) => <figure className="doc-thumb" key={page.id}><img src={page.preview} alt={`ตัวอย่างหน้า ${index + 1}`}/><button type="button" className="doc-remove" onClick={() => removePage(page.id)} aria-label={`ลบ ${page.title}`}><X size={15}/></button><figcaption title={page.title}>{String(index + 1).padStart(2, '0')} · {page.title}</figcaption></figure>)}</div>
          <button className="button primary" type="button" onClick={() => void runOcr()} disabled={ocrBusy}>{ocrBusy ? <><LoaderCircle size={16} className="spin"/> กำลังอ่านเอกสาร…</> : <><ScanText size={16}/> อ่านข้อมูลด้วย OCR {pages.length} หน้า</>}</button>
          {ocrBusy && <div className="stack"><div className="split small"><span>{progressLabel || 'กำลังเตรียมระบบอ่านข้อความ'}</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${Math.max(3, progress)}%` }}/></div></div>}
        </div>}
        {rawOcrPages.length > 0 && <div className="ocr-summary space">
          {rawOcrPages.map(page => <div className="ocr-page-summary" key={page.pageName}>
            <strong>{page.documentNumber || 'ไม่พบเลขใบนำส่ง'} · {page.pageName}</strong>
            <span>วันที่ {page.documentDate || 'อ่านไม่ได้'} · ตรวจพบ {page.detectedRowCount} แถว · ยอดท้ายใบ {page.printedTotal ?? 'อ่านไม่ได้'} กล่อง · OCR {Math.round(page.confidence)}%</span>
            <span>การจับคู่แถว: {page.geometryValid ? 'เส้นตารางชัด' : 'ต้องตรวจตำแหน่งแถว'} · ผล OCR ไม่ได้แปลว่าตรวจผ่าน</span>
          </div>)}
          <div className="ocr-page-summary">
            <strong>ผลตรวจสอบแยกส่วน</strong>
            <span>แถวทั้งหมด {items.length} · TFS รูปแบบถูกต้อง {items.filter(item => EVEANDBOY_TEMPLATE.expectedTfsPattern.test(item.transfer_number)).length} · จำนวนที่อ่านได้ {items.filter(item => Number.isInteger(item.expected_quantity)).length}</span>
            <span>ผลรวมช่องจำนวน {totalValidation.rowTotal} · ยอดท้ายเอกสาร {printedTotal ?? 'อ่านไม่ได้'} · {totalValidation.matches ? 'ยอดตรงกัน' : 'ยอดไม่ตรงหรืออ่านยอดท้ายใบไม่ได้'}</span>
          </div>
        </div>}
        {(notice || error) && <div className={error ? 'review-note' : 'status-line space'} role="status">{error ? error : <><Check size={15} color="var(--green)"/>{notice}</>}</div>}
        {createdSessionId && error && <div className="row space"><button className="button primary" type="button" disabled={creating} onClick={() => { setCreating(true); void uploadDocumentsAndOpen(createdSessionId).catch(cause => setError(cause instanceof Error ? cause.message : 'อัปโหลดเอกสารไม่สำเร็จ')).finally(() => setCreating(false)); }}>ลองจัดเก็บเอกสารอีกครั้ง</button><Link className="button" href={`/session/${createdSessionId}`}>ไปหน้ารอบที่สร้างแล้ว</Link></div>}
        <p className="muted small" style={{ margin: '15px 0 0' }}>OCR ทำงานบนอุปกรณ์นี้ ภาพไม่ถูกส่งไปบริการ OCR ภายนอก · ครั้งแรกต้องเชื่อมอินเทอร์เน็ตเพื่อโหลดตัวอ่านข้อความ</p>
      </section>

      <section className="card space">
        <div className="split mobile-stack"><div><h2 className="section-title">2. ตรวจทานรายการที่อ่านได้</h2><p className="muted small" style={{ margin: '4px 0 0' }}>คลิกแต่ละแถวเพื่อเทียบภาพต้นฉบับกับภาพตัดเฉพาะช่อง ก่อนกดยืนยัน</p></div><div className="tag">{includedItems.length} รายการนำเข้า · {expectedTotal} กล่อง</div></div>
        {activeItem && activePage && <div className="ocr-evidence space">
          <div className="ocr-original"><div className="split"><strong>เอกสารที่ปรับมุมแล้ว · แถว {activeItem.rowNumber}</strong><span className={`tag ${activeItem.flags.length ? 'warn' : ''}`}>{activeItem.flags.length ? activeItem.flags.join(' · ') : 'NORMAL'}</span></div>
            <div className="ocr-highlight-wrap"><img src={activePage.preview} alt="ใบโอนหลังปรับแนวกระดาษ"/><span className="ocr-row-highlight" style={{ top: `${activeItem.highlight.top}%`, height: `${activeItem.highlight.height}%` }}/></div>
          </div>
          <div className="ocr-crop-grid">
            {[['ภาพแถว', activeItem.rowCrop], ['ช่อง TFS', activeItem.tfsCrop], ['ต้นทาง', activeItem.sourceCrop], ['ปลายทาง', activeItem.destinationCrop], ['จำนวนกล่อง', activeItem.quantityCrop]].map(([label, src]) => <figure key={label}><figcaption>{label}</figcaption>{src ? <img src={src} alt={`ภาพตัด ${label}`}/> : <span className="muted small">ไม่มีภาพ</span>}</figure>)}
          </div>
        </div>}
        {duplicates.length > 0 && <div className="review-note space"><div className="split mobile-stack"><span>พบเลข TFS ซ้ำ: {Array.from(new Set(duplicates.map(item => item.transfer_number))).join(', ')} · เลือกว่าจะรวมจำนวนหรือแก้เลขรายการ</span><button className="button" type="button" onClick={mergeDuplicates}>รวม TFS ซ้ำ</button></div></div>}
        {items.length === 0 ? <div className="muted space">ยังไม่มีรายการที่อ่านได้ เพิ่มภาพแล้วกด “อ่านข้อมูลด้วย OCR” หรือเพิ่มรายการด้วยตนเองได้</div> : <div className="tablewrap mobile-cards ocr-cards space"><table><thead><tr><th>#</th><th>เลข TFS</th><th>ต้นทาง</th><th>ปลายทาง</th><th>กล่อง</th><th>ตรวจสอบ</th><th>ยืนยัน</th><th/></tr></thead><tbody>{items.map((item, index) => {
          const validation = validateEveandboyRow({ transfer_number: item.transfer_number, source_branch: item.source_branch, destination_branch: item.destination_branch, expected_quantity: item.expected_quantity, confidence: item.confidence, rowNumber: item.rowNumber, sequenceNumber: item.sequenceNumber, geometryValid: item.geometryValid, flags: item.flags, userDecision: item.userDecision });
          const rowStatuses = Array.from(new Set([...item.flags, ...(!validation.formatValid || !validation.rowMappingValid || item.confidence < 85 ? ['NEEDS_REVIEW'] : [])]));
          return <tr key={`${index}-${item.pageName}`} className={`${item.flags.includes('CROSSED_OUT') ? 'row-crossed' : ''} ${selectedReviewRow === index ? 'row-selected' : ''}`} onClick={() => setSelectedReviewRow(index)}>
          <td className="muted" data-label="#"><input className="sequence-input" aria-label={`ลำดับแถว ${index + 1}`} type="number" min="1" max="999" value={item.sequenceNumber ?? ''} onChange={event => changeItem(index, 'sequenceNumber', event.target.value)} placeholder="ลำดับ"/><button className="review-select" type="button" onClick={event => { event.stopPropagation(); setSelectedReviewRow(index); }}>ดูภาพต้นฉบับ</button><div className="confidence-low">หน้า {item.pageNumber || '—'} · แถวที่ตรวจพบ {item.rowNumber || 'เพิ่มเอง'}</div></td>
          <td data-label="เลข TFS"><input className="table-input" aria-label={`เลข TFS แถว ${index + 1}`} value={item.transfer_number} onChange={event => changeItem(index, 'transfer_number', event.target.value)} placeholder="TFS260604867"/></td>
          <td data-label="ต้นทาง"><input className="table-input" aria-label={`ต้นทางแถว ${index + 1}`} value={item.source_branch} onChange={event => changeItem(index, 'source_branch', event.target.value)} placeholder="84_KPP"/></td>
          <td data-label="ปลายทาง"><input className="table-input" aria-label={`ปลายทางแถว ${index + 1}`} value={item.destination_branch} onChange={event => changeItem(index, 'destination_branch', event.target.value)} placeholder="93_LCR"/></td>
          <td data-label="กล่อง"><input className="quantity-input" aria-label={`จำนวนกล่องแถว ${index + 1}`} type="number" min="0" max="100000" value={item.expected_quantity ?? ''} onChange={event => changeItem(index, 'expected_quantity', event.target.value)}/></td>
          <td className="small" data-label="ตรวจสอบ"><span className={`tag ${validation.formatValid ? 'good' : 'bad'}`}>รูปแบบ {validation.formatValid ? 'ผ่าน' : 'แก้ไข'}</span><span className={`tag ${validation.rowMappingValid ? 'good' : 'warn'}`}>จับคู่แถว {validation.rowMappingValid ? 'ผ่าน' : 'ตรวจเอง'}</span><span className="confidence-low">OCR {Math.round(item.confidence)}% · {rowStatuses.length ? rowStatuses.join(', ') : 'NORMAL'}</span>{validation.lookalikes.length > 0 && <span className="confidence-low">อักขระคล้ายกัน: {validation.lookalikes.map(value => `${value.character}/${value.possibleLookalike}`).join(', ')}</span>}</td>
          <td data-label="ยืนยัน">{item.flags.length > 0 && <div className="row-choice"><button className={`button ${item.userDecision === 'INCLUDE' ? 'primary' : ''}`} type="button" onClick={() => decideRow(index, 'INCLUDE')}>นำเข้า</button><button className={`button ${item.userDecision === 'EXCLUDE' ? 'primary' : ''}`} type="button" onClick={() => decideRow(index, 'EXCLUDE')}>ไม่นำเข้า</button></div>}{item.needsReview ? <button className="button review-row" type="button" disabled={item.flags.length > 0 && item.userDecision === 'UNDECIDED'} onClick={() => confirmItem(index)}>{item.userDecision === 'EXCLUDE' ? 'ยืนยันไม่นำเข้า' : 'ยืนยันหลังตรวจภาพ'}</button> : <span className="tag good">ผู้ใช้ตรวจแล้ว{item.userDecision === 'EXCLUDE' ? ' · ไม่นำเข้า' : ''}</span>}</td>
          <td data-label="ลบ"><button className="icon-button" type="button" aria-label={`ลบรายการ ${item.transfer_number}`} onClick={() => setItems(current => current.filter((_, i) => i !== index))}><Trash2 size={15}/></button></td>
        </tr>})}</tbody></table></div>}
        <div className="split mobile-stack space"><button className="button" type="button" onClick={() => setItems(current => [...current, blankItem()])}><Plus size={15}/> เพิ่มรายการเอง</button><strong>ยอดตามใบโอน {expectedTotal.toLocaleString('th-TH')} กล่อง</strong></div>
        {rawOcrPages.length > 0 && <div className={`review-note space ${totalNeedsAck ? 'review-total-error' : ''}`}><strong>ตรวจยอดรวม: อ่านทุกแถว {totalValidation.rowTotal} กล่อง · นำเข้า {selectedTotalValidation.rowTotal} กล่อง · ยอดท้ายเอกสาร {printedTotal ?? 'อ่านไม่ได้'} กล่อง · {totalValidation.matches && selectedTotalValidation.matches ? 'ตรงกัน' : 'ไม่ตรงหรืออ่านยอดท้ายใบไม่ได้'}</strong>{totalNeedsAck && <label className="total-ack"><input type="checkbox" checked={totalAcknowledged} onChange={event => setTotalAcknowledged(event.target.checked)}/> ฉันเทียบกับใบโอนจริงและรับทราบผลต่างหรือยอดที่ OCR อ่านไม่ได้</label>}</div>}
        {error && items.length > 0 && <p className="error small">{error}</p>}
        <div className="split mobile-stack space"><Link className="button" href="/"><ArrowLeft size={15}/> ย้อนกลับ</Link><button className="button primary" type="button" disabled={!canCreate || creating || ocrBusy || !!createdSessionId} onClick={() => void createSession()}>{creating ? <><LoaderCircle size={16} className="spin"/> กำลังสร้างรอบ…</> : <>ตรวจแล้ว · สร้างรอบตรวจรับ <ChevronRight size={16}/></>}</button></div>
        {!canCreate && items.length > 0 && <div className="muted small" style={{ marginTop: 10, textAlign: 'right' }}>ตรวจรูปแบบ TFS และข้อมูลทุกช่อง · ตัดสินใจแถวที่มีเครื่องหมาย · ยืนยันทุกแถว · ตรวจยอดรวมก่อนสร้างรอบ</div>}
      </section>
      <MobileNav active="receive"/>
      <style jsx>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.camera-card{border:1px solid var(--line);border-radius:13px;padding:12px;background:#f8f8f4}`}</style>
    </main>
  );
}
