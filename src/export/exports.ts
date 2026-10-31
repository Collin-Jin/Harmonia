import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { toMidi } from '../music/midi';
import { toMusicXML } from '../music/musicxml';
import type { Arrangement } from '../music/types';
import { renderArrangement, type PlayOptions } from '../audio/player';
import { audioBufferToWav } from '../audio/wav';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'harmonia';

export function exportMidi(arr: Arrangement, title: string) {
  const bytes = toMidi(arr);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'audio/midi' }), `${slug(title)}.mid`);
}

export function exportMusicXml(arr: Arrangement, title: string) {
  const xml = toMusicXML(arr, { title });
  downloadBlob(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }), `${slug(title)}.musicxml`);
}

/** Engrave the score on A4 pages with OpenSheetMusicDisplay and convert the SVG pages to a vector PDF. */
export async function buildPdf(arr: Arrangement, title: string): Promise<Blob> {
  const xml = toMusicXML(arr, { title });
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-12000px', top: '0', width: '1100px', background: '#fff' });
  document.body.appendChild(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: 'svg',
      autoResize: false,
      drawTitle: true,
      drawComposer: true,
      drawPartNames: true,
      drawPartAbbreviations: true,
      autoBeam: true,
      pageFormat: 'A4_P',
      pageBackgroundColor: '#FFFFFF',
      defaultColorMusic: '#000000',
    });
    await osmd.load(xml);
    osmd.render();
    const svgs = Array.from(host.querySelectorAll('svg'));
    if (!svgs.length) throw new Error('Score rendering produced no pages');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setProperties({ title, creator: 'Harmonia', subject: 'Vocal harmony arrangement' });
    for (let i = 0; i < svgs.length; i++) {
      if (i > 0) doc.addPage();
      const svg = svgs[i];
      const w = parseFloat(svg.getAttribute('width') || '0') || svg.getBoundingClientRect().width;
      const h = parseFloat(svg.getAttribute('height') || '0') || svg.getBoundingClientRect().height;
      const scale = Math.min(W / w, H / h);
      // svg2pdf drops text whose size is in pt or whose family it can't map (OSMD's tempo mark uses both).
      svg.querySelectorAll('text').forEach((t) => {
        const fs = t.getAttribute('font-size') ?? '';
        if (fs.endsWith('pt')) t.setAttribute('font-size', `${(parseFloat(fs) * 4) / 3}px`);
        if ((t.getAttribute('font-family') ?? '').toLowerCase() === 'times') t.setAttribute('font-family', 'Times New Roman');
      });
      await (doc as any).svg(svg, { x: 0, y: 0, width: w * scale, height: h * scale });
    }
    return doc.output('blob');
  } finally {
    host.remove();
  }
}

export async function exportPdf(arr: Arrangement, title: string) {
  const blob = await buildPdf(arr, title);
  downloadBlob(blob, `${slug(title)}.pdf`);
}

export async function exportWav(arr: Arrangement, title: string, opts: PlayOptions) {
  const buf = await renderArrangement(arr, opts);
  downloadBlob(audioBufferToWav(buf), `${slug(title)}.wav`);
}
