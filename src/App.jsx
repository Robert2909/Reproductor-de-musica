import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderOpen, Music, BarChart2, Settings, ListMusic, Compass,
  Download, Search, ArrowUpDown, Disc3, X, Info, Mic2, Disc, Layers, Calendar, ChevronLeft,
  Play, Pause, Volume1, Volume2, VolumeX, SkipBack, SkipForward, Trash2,
  Repeat, Shuffle, Square, Maximize2, Minimize2, Zap, Sliders, Activity, Sparkles, Waves, Radio,
  Clock, RotateCcw, AlertTriangle, Moon, Timer, HardDrive, CheckCircle2, Heart, Plus, Edit3, Filter,
  ListOrdered, Copy, FileText, Upload, Share2, ArrowUp, ArrowDown, PictureInPicture2, Layout
} from 'lucide-react';
import * as musicMetadata from 'music-metadata-browser';
import {
  saveDirectoryHandle,
  getSavedDirectoryHandle,
  clearSavedDirectoryHandle,
  saveCachedLibrary,
  getCachedLibrary,
  clearCachedLibrary,
  isOPFSSupported,
  getTrackStorageKey,
  saveTrackToOPFS,
  getTrackFromOPFS,
  hasTrackInOPFS,
  deleteTrackFromOPFS,
  listOPFSTracks,
  clearOPFSTracks,
  getStorageEstimate,
  cloneLibraryToOPFS,
  saveFavoritesToDB,
  getFavoritesFromDB,
  savePlayCountsToDB,
  getPlayCountsFromDB
} from './db';

const normalizeText = (str) => {
  if (!str) return '';
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
};

const isAnyImageName = (filename) => {
  return /\.(jpe?g|png|webp|bmp|gif|avif)$/i.test(filename || '');
};

const isFolderCoverName = (filename) => {
  const base = (filename || '').toLowerCase().replace(/\.[^/.]+$/, "");
  return ['cover', 'folder', 'front', 'album', 'artwork', 'art'].includes(base);
};

const scanEntryRecursively = async (entry, path = '') => {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        if (path) {
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: `${path}/${file.name}`,
              configurable: true
            });
          } catch (e) {}
        }
        resolve([file]);
      }, () => resolve([]));
    });
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const readAllEntries = async () => {
      const allEntries = [];
      let batch;
      do {
        batch = await new Promise((resolve) => dirReader.readEntries(resolve, () => resolve([])));
        if (batch && batch.length > 0) {
          allEntries.push(...batch);
        }
      } while (batch && batch.length > 0);
      return allEntries;
    };
    const childEntries = await readAllEntries();
    const newPath = path ? `${path}/${entry.name}` : entry.name;
    const childFiles = await Promise.all(
      childEntries.map((child) => scanEntryRecursively(child, newPath))
    );
    return childFiles.flat();
  }
  return [];
};

const getImageDimensions = (url) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
};

const formatTime = (time) => {
  if (isNaN(time)) return '0:00';
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const formatZenTime = (current, duration, mode) => {
  if (!duration || isNaN(duration)) {
    if (mode === 'percent') return '0%';
    if (mode === 'none') return '';
    return '0:00';
  }
  const cur = Math.max(0, current);
  const cMins = Math.floor(cur / 60);
  const cSecs = Math.floor(cur % 60);
  const curStr = `${cMins}:${cSecs < 10 ? '0' : ''}${cSecs}`;

  if (mode === 'current') return curStr;

  const dMins = Math.floor(duration / 60);
  const dSecs = Math.floor(duration % 60);
  const durStr = `${dMins}:${dSecs < 10 ? '0' : ''}${dSecs}`;

  if (mode === 'both') return `${curStr} / ${durStr}`;

  if (mode === 'remaining') {
    const rem = Math.max(0, duration - cur);
    const rMins = Math.floor(rem / 60);
    const rSecs = Math.floor(rem % 60);
    return `-${rMins}:${rSecs < 10 ? '0' : ''}${rSecs}`;
  }

  if (mode === 'percent') {
    const pct = Math.floor((cur / duration) * 100);
    return `${pct}%`;
  }

  return curStr;
};

const formatSleepTime = (seconds) => {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (mins > 0) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  return `${secs}s`;
};

const formatBadgeTime = (sec) => {
  if (!sec || sec <= 0) return '0s';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSecs = sec % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins > 0 ? `${mins}m` : ''}`.trim();
  }
  if (mins > 0) {
    const sStr = remSecs < 10 ? `0${remSecs}` : remSecs;
    return `${mins}:${sStr}`;
  }
  return `${remSecs}s`;
};

const ZenClock = ({ position = 'top-right', format = '24h', showSeconds = false, showDate = true, styleType = 'minimal', style = {} }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  let hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  let ampm = '';

  if (format === '12h') {
    ampm = hours >= 12 ? ' PM' : ' AM';
    hours = hours % 12 || 12;
  }

  const hStr = hours < 10 && format === '24h' ? `0${hours}` : String(hours);
  const mStr = minutes < 10 ? `0${minutes}` : String(minutes);
  const sStr = seconds < 10 ? `0${seconds}` : String(seconds);

  const timeStr = showSeconds ? `${hStr}:${mStr}:${sStr}${ampm}` : `${hStr}:${mStr}${ampm}`;

  const dateStr = showDate
    ? now.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
      .replace('.', '')
      .replace(/^\w/, c => c.toUpperCase())
    : '';

  const positionStyles = {
    'top-left': { position: 'absolute', top: '36px', left: '44px', alignItems: 'flex-start' },
    'top-center': { position: 'absolute', top: '36px', left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
    'top-right': { position: 'absolute', top: '36px', right: '44px', alignItems: 'flex-end' },
    'bottom-left': { position: 'absolute', bottom: '36px', left: '44px', alignItems: 'flex-start' },
    'bottom-right': { position: 'absolute', bottom: '36px', right: '44px', alignItems: 'flex-end' },
    'above-cover': { position: 'absolute', bottom: 'calc(100% + 22px)', left: '50%', transform: 'translateX(-50%)', width: 'max-content', alignItems: 'center' },
    'center': { position: 'relative', top: 'auto', left: 'auto', right: 'auto', bottom: 'auto', transform: 'none', alignItems: 'center', textAlign: 'center' }
  }[position] || { position: 'absolute', top: '36px', right: '44px', alignItems: 'flex-end' };

  return (
    <div
      className={`zen-clock-container style-${styleType}`}
      style={{
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none',
        userSelect: 'none',
        ...positionStyles,
        ...style
      }}
    >
      <div
        className="zen-clock-time"
        style={{
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1
        }}
      >
        {timeStr}
      </div>
      {showDate && dateStr && (
        <div
          className="zen-clock-date"
          style={{
            fontSize: '12px',
            opacity: 0.65,
            marginTop: '4px',
            letterSpacing: '0.04em'
          }}
        >
          {dateStr}
        </div>
      )}
    </div>
  );
};

const VolumeHUD = ({ isZenMode }) => {
  const [hudData, setHudData] = useState({ visible: false, volume: 25, isMuted: false });
  const timerRef = useRef(null);

  useEffect(() => {
    const onFeedback = (e) => {
      // SOLO mostrar la retroalimentación si estamos en Modo Zen
      if (!isZenMode) return;
      const { volume, isMuted } = e.detail;
      setHudData({ visible: true, volume, isMuted });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setHudData(prev => ({ ...prev, visible: false }));
      }, 1400);
    };

    window.addEventListener('musicPlayer_volumeFeedback', onFeedback);
    return () => {
      window.removeEventListener('musicPlayer_volumeFeedback', onFeedback);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isZenMode]);

  // Si salimos del modo Zen, ocultar inmediatamente el HUD
  useEffect(() => {
    if (!isZenMode && hudData.visible) {
      setHudData(prev => ({ ...prev, visible: false }));
    }
  }, [isZenMode, hudData.visible]);

  if (!isZenMode && !hudData.visible) return null;

  return (
    <div
      className={`zen-volume-hud ${hudData.isMuted ? 'muted-mode' : ''}`}
      style={{
        position: 'fixed',
        top: '32px',
        left: '50%',
        transform: hudData.visible ? 'translate(-50%, 0) scale(1)' : 'translate(-50%, -10px) scale(0.96)',
        opacity: hudData.visible ? 1 : 0,
        pointerEvents: 'none',
        zIndex: 10001,
        transition: 'all 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        padding: '6px 14px',
        background: hudData.isMuted
          ? 'rgba(28, 12, 16, 0.72)'
          : 'rgba(12, 12, 18, 0.65)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: hudData.isMuted
          ? '1px solid rgba(255, 75, 95, 0.25)'
          : '1px solid rgba(255, 255, 255, 0.10)',
        borderRadius: '24px',
        boxShadow: hudData.isMuted
          ? '0 12px 32px rgba(0, 0, 0, 0.55), 0 0 20px rgba(255, 75, 95, 0.12)'
          : '0 14px 36px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
      }}
    >
      {hudData.isMuted ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: 'rgba(255, 75, 95, 0.15)',
              color: '#ff4d6d'
            }}
          >
            <VolumeX size={13} style={{ filter: 'drop-shadow(0 0 6px rgba(255, 77, 109, 0.6))' }} />
          </div>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#ff6b8b',
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}
          >
            Silenciado
          </span>
        </>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              color: hudData.volume === 0 ? 'rgba(255,255,255,0.4)' : 'var(--accent-color)'
            }}
          >
            {hudData.volume === 0 ? (
              <VolumeX size={14} />
            ) : hudData.volume < 50 ? (
              <Volume1 size={14} style={{ filter: 'drop-shadow(0 0 6px var(--accent-color))' }} />
            ) : (
              <Volume2 size={14} style={{ filter: 'drop-shadow(0 0 6px var(--accent-color))' }} />
            )}
          </div>

          <div
            style={{
              width: '74px',
              height: '3px',
              background: 'rgba(255, 255, 255, 0.10)',
              borderRadius: '3px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(hudData.volume)}%`,
                background: 'linear-gradient(90deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 80%, white))',
                boxShadow: '0 0 8px var(--accent-color)',
                borderRadius: '3px',
                transition: 'width 0.08s ease-out'
              }}
            />
          </div>

          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.9)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: '28px',
              textAlign: 'right'
            }}
          >
            {`${Math.round(hudData.volume)}%`}
          </span>
        </>
      )}
    </div>
  );
};

const sortAlpha = (arr) => {
  return arr.sort((a, b) => {
    const aVal = normalizeText(a.title);
    const bVal = normalizeText(b.title);
    return aVal < bVal ? -1 : (aVal > bVal ? 1 : 0);
  });
};

// Solicita asignación de GPU de alto rendimiento al sistema operativo y navegador
const requestHighPerformanceGPU = () => {
  try {
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 1;
    probeCanvas.height = 1;
    const gl = probeCanvas.getContext('webgl2', { powerPreference: 'high-performance' }) ||
      probeCanvas.getContext('webgl', { powerPreference: 'high-performance' }) ||
      probeCanvas.getContext('experimental-webgl', { powerPreference: 'high-performance' });
    if (navigator.gpu) {
      navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => { });
    }
    return Boolean(gl);
  } catch (e) {
    return false;
  }
};

const useSmoothScroll = (ref, active) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let targetScroll = el.scrollTop;
    let currentScroll = el.scrollTop;
    let rafId = null;
    let isScrolling = false;

    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        targetScroll = Math.min(el.scrollHeight - el.clientHeight, Math.max(0, targetScroll + e.deltaY * 1.5));

        if (!isScrolling) {
          isScrolling = true;
          const animateScroll = () => {
            currentScroll += (targetScroll - currentScroll) * 0.08;
            el.scrollTop = currentScroll;
            if (Math.abs(targetScroll - currentScroll) > 1) {
              rafId = requestAnimationFrame(animateScroll);
            } else {
              el.scrollTop = targetScroll;
              isScrolling = false;
            }
          };
          rafId = requestAnimationFrame(animateScroll);
        }
      }
    };

    const onScroll = () => {
      if (!isScrolling) {
        targetScroll = el.scrollTop;
        currentScroll = el.scrollTop;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [ref, active]);
};

const renderToastIcon = (toast) => {
  if (!toast) return <CheckCircle2 size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;

  const { isError, icon, message = '' } = toast;
  if (isError) {
    return <AlertTriangle size={16} style={{ color: '#ff4d6d', flexShrink: 0 }} />;
  }

  const explicit = (icon || '').toLowerCase();
  if (explicit === 'zen' || explicit === 'sparkles') {
    return <Sparkles size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'pip' || explicit === 'pictureinpicture') {
    return <PictureInPicture2 size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'moon' || explicit === 'sleep' || explicit === 'timer') {
    return <Moon size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'heart' || explicit === 'favorite') {
    return <Heart size={16} style={{ color: '#ec4899', fill: '#ec4899', flexShrink: 0 }} />;
  }
  if (explicit === 'queue' || explicit === 'listordered') {
    return <ListOrdered size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'playlist' || explicit === 'listmusic') {
    return <ListMusic size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'copy') {
    return <Copy size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'download') {
    return <Download size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'upload' || explicit === 'backup') {
    return <HardDrive size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'sync' || explicit === 'rotateccw' || explicit === 'reset') {
    return <RotateCcw size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (explicit === 'trash' || explicit === 'delete') {
    return <Trash2 size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />;
  }
  if (explicit === 'color' || explicit === 'palette' || explicit === 'theme') {
    return <Sliders size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }

  // Mapeo semántico automático basado en el texto del mensaje
  const msg = message.toLowerCase();

  if (msg.includes('zen') || msg.includes('reposo')) {
    return <Sparkles size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('mini-reproductor') || msg.includes('pip') || msg.includes('flotante')) {
    return <PictureInPicture2 size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('temporizador') || msg.includes('apagado') || msg.includes('buenas noches')) {
    return <Moon size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('favorita')) {
    return <Heart size={16} style={{ color: '#ec4899', fill: msg.includes('eliminad') ? 'none' : '#ec4899', flexShrink: 0 }} />;
  }
  if (msg.includes('cola') || msg.includes('a continuación')) {
    return <ListOrdered size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('copiado')) {
    return <Copy size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('m3u8') || msg.includes('descargada') || msg.includes('instalada')) {
    return <Download size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('copia de seguridad') || msg.includes('respaldo') || msg.includes('estadísticas json')) {
    return <HardDrive size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('sincroniz') || msg.includes('restablecido')) {
    return <RotateCcw size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('clon') || msg.includes('guardadas en almacenamiento') || msg.includes('memoria permanente')) {
    return <Zap size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('eliminad') || msg.includes('vaciada')) {
    return <Trash2 size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />;
  }
  if (msg.includes('lista dinámica') || msg.includes('lista "')) {
    return <ListMusic size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('color') || msg.includes('hexadecimal')) {
    return <Sliders size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
  }
  if (msg.includes('cargada con éxito') || msg.includes('conectado para') || msg.includes('biblioteca al día')) {
    return <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />;
  }

  return <CheckCircle2 size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />;
};

const CustomPlayer = ({
  src,
  activeSong,
  onNext,
  onPrev,
  onStop,
  onPlayEmpty,
  onPlayStatusChange,
  liveBarsRef,
  pipLiveBarsRef,
  largeCanvasRef,
  largeSpectrumEnabled,
  prevSpectrumRef,
  zenCanvasRef,
  zenCoverRef,
  zenPlaybackRefs,
  zenVisualConfig,
  isIdle,
  idleModeEnabled,
  onToggleIdleMode,
  pipAutoOpen,
  onTogglePipAutoOpen,
  smoothFade,
  hotkeys = { playPause: 'Space', stop: 'S', nextTrack: 'Shift+Right', prevTrack: 'Shift+Left', forward: 'Right', rewind: 'Left', volUp: 'Up', volDown: 'Down', mute: 'M', random: 'R', repeat: 'A', fullscreen: 'F', search: 'Ctrl+K', clearSearch: 'Escape' },
  isFullscreen,
  onToggleFullscreen,
  sleepTimer = { active: false, mode: 'time', remainingSeconds: null, remainingTracks: null, label: '' },
  onActivateSleepTimerByTime,
  onActivateSleepTimerByTracks,
  onCancelSleepTimer,
  onDecrementSleepTimerTracks,
  onTickSleepTimerSeconds,
  sleepTimerFadeSeconds = 5,
  playQueue = [],
  onRemoveFromQueue,
  onMoveQueueItem,
  onClearQueue,
  onPlayFromQueue,
  onTogglePiP,
  pipActive,
  pipEnabled = true,
  onTimeProgress
}) => {
  const audioRef = useRef(null);
  const progressBarRef = useRef(null);
  const sleepTimerMenuRef = useRef(null);
  const queueMenuRef = useRef(null);
  const consecutiveErrorsRef = useRef(0);
  const sleepFadeStartedRef = useRef(false);
  const [showSleepTimerMenu, setShowSleepTimerMenu] = useState(false);
  const [showQueueMenu, setShowQueueMenu] = useState(false);
  const [sleepPopoverTab, setSleepPopoverTab] = useState('time'); // 'time' | 'tracks'
  const [customHours, setCustomHours] = useState('');
  const [customMinutes, setCustomMinutes] = useState('');
  const [customTracks, setCustomTracks] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('musicPlayer_volume');
    if (saved !== null) {
      let v = parseFloat(saved);
      if (isNaN(v)) return 25;
      if (v <= 1) return v * 100;
      if (v === 50 || v === 35) return 25; // Migrate from previous defaults
      return v;
    }
    return 25;
  });
  const [repeatMode, setRepeatMode] = useState(() => {
    const saved = localStorage.getItem('musicPlayer_repeat');
    return saved !== null ? parseInt(saved, 10) : 0;
  });
  const [isRandom, setIsRandom] = useState(() => {
    return localStorage.getItem('musicPlayer_random') === 'true';
  });
  const [isMuted, setIsMuted] = useState(false);
  const [spectrum, setSpectrum] = useState(Array(250).fill(10));
  const [finalSpectrum, setFinalSpectrum] = useState(null);
  const [sweepIndex, setSweepIndex] = useState(-1);
  const matrixIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const isRoutedRef = useRef(false);
  const prevZenRef = useRef(new Float32Array(128));

  const zenPlaybackRefsRef = useRef(zenPlaybackRefs);
  zenPlaybackRefsRef.current = zenPlaybackRefs;

  const zenVisualConfigRef = useRef(zenVisualConfig);
  zenVisualConfigRef.current = zenVisualConfig;

  const onTimeProgressRef = useRef(onTimeProgress);
  onTimeProgressRef.current = onTimeProgress;

  const SAFE_MAX_VOLUME = 1.0; // Cambiado a 1.0 para probar volumen nativo

  useEffect(() => {
    if (onPlayStatusChange) onPlayStatusChange(isPlaying);
  }, [isPlaying, onPlayStatusChange]);

  useEffect(() => {
    let rafId;
    let playStart = isPlaying ? Date.now() : 0;
    const updateBars = () => {
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        const data = dataArrayRef.current;
        const now = Date.now();
        const isStarting = (now - playStart) < 300;

        if (liveBarsRef?.current) {
          const binsPerBar = Math.floor(data.length / 4);
          for (let i = 0; i < 4; i++) {
            if (!liveBarsRef.current[i]) continue;
            let targetScale = 0.15;
            if (isPlaying) {
              let sum = 0;
              for (let j = 0; j < binsPerBar; j++) {
                sum += data[i * binsPerBar + j];
              }
              const avg = sum / binsPerBar;
              targetScale = 0.15 + (avg / 255) * 0.85;
              liveBarsRef.current[i].style.transition = isStarting ? 'transform 0.3s ease' : 'none';
            } else {
              liveBarsRef.current[i].style.transition = 'transform 0.3s ease';
            }
            liveBarsRef.current[i].style.transform = `scaleY(${targetScale})`;
          }
        }

        if (pipLiveBarsRef?.current) {
          const binsPerBar = Math.floor(data.length / 4);
          for (let i = 0; i < 4; i++) {
            if (!pipLiveBarsRef.current[i]) continue;
            let targetScale = 0.15;
            if (isPlaying) {
              let sum = 0;
              for (let j = 0; j < binsPerBar; j++) {
                sum += data[i * binsPerBar + j];
              }
              const avg = sum / binsPerBar;
              targetScale = 0.15 + (avg / 255) * 0.85;
              pipLiveBarsRef.current[i].style.transition = isStarting ? 'transform 0.3s ease' : 'none';
            } else {
              pipLiveBarsRef.current[i].style.transition = 'transform 0.3s ease';
            }
            pipLiveBarsRef.current[i].style.transform = `scaleY(${targetScale})`;
          }
        }

        if (largeCanvasRef?.current && largeSpectrumEnabled && prevSpectrumRef?.current) {
          const canvas = largeCanvasRef.current;
          const ctx = canvas.getContext('2d');
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          const accentColor = document.documentElement.style.getPropertyValue('--accent-color').trim() || '#007acc';
          ctx.fillStyle = accentColor;
          ctx.globalAlpha = 0.15;

          const bins = data.length;
          const barWidth = width / bins;
          const prev = prevSpectrumRef.current;

          for (let i = 0; i < bins; i++) {
            let target = isPlaying ? data[i] : 0;
            prev[i] += (target - prev[i]) * 0.2; // Suavizado de caída/subida

            const barHeight = (prev[i] / 255) * height;
            ctx.fillRect(i * barWidth + 1, height - barHeight, barWidth - 2, barHeight);
          }
          ctx.globalAlpha = 1.0;
        }

        // Renderizado de ultra-alto rendimiento en Canvas para Modo Zen (GPU acelerado)
        if (zenCanvasRef?.current && isIdle) {
          const canvas = zenCanvasRef.current;
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const targetW = Math.floor(rect.width * dpr);
          const targetH = Math.floor(rect.height * dpr);

          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
          if (ctx && targetW > 0 && targetH > 0) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const w = rect.width;
            const h = rect.height;
            ctx.clearRect(0, 0, w, h);

            const accentColor = document.documentElement.style.getPropertyValue('--accent-color').trim() || '#007acc';
            const prevZen = prevZenRef.current;
            const mode = zenVisualConfig?.mode || 'bars';

            // Suavizado inercial de frecuencias
            for (let i = 0; i < 128; i++) {
              const raw = isPlaying && data[i] !== undefined ? data[i] : 0;
              prevZen[i] += (raw - prevZen[i]) * 0.22;
            }

            // Micropulso sutil reactivo en la portada (vía compositor GPU sin layout reflow)
            if (zenCoverRef?.current) {
              if (zenVisualConfig?.coverPulse && isPlaying) {
                const bassAvg = (prevZen[0] + prevZen[1] + prevZen[2] + prevZen[3]) / (4 * 255);
                const scale = 1 + bassAvg * 0.035;
                zenCoverRef.current.style.transform = `scale(${scale})`;
              } else {
                zenCoverRef.current.style.transform = 'scale(1)';
              }
            }

            if (mode === 'bars') {
              // 64 barras centrales simétricas redondeadas
              const numBars = 64;
              const barWidth = 6;
              const gap = 6;
              const totalWidth = numBars * (barWidth + gap) - gap;
              const startX = (w - totalWidth) / 2;
              const centerY = h / 2;
              const maxH = h * 0.45;

              ctx.fillStyle = accentColor;
              ctx.shadowColor = accentColor;
              ctx.shadowBlur = 8;

              for (let i = 0; i < numBars; i++) {
                const val = prevZen[i] / 255;
                const barH = Math.max(4, val * maxH);
                const x = startX + i * (barWidth + gap);
                const y = centerY - barH / 2;

                ctx.beginPath();
                if (ctx.roundRect) {
                  ctx.roundRect(x, y, barWidth, barH, 3);
                } else {
                  ctx.rect(x, y, barWidth, barH);
                }
                ctx.fill();
              }
            } else if (mode === 'wave') {
              // Onda fluida simétrica con reflejo bezier continuo
              const numPoints = 48;
              const step = w / (numPoints - 1);
              const centerY = h / 2;
              const maxH = h * 0.35;

              const topPoints = [];
              const bottomPoints = [];

              for (let i = 0; i < numPoints; i++) {
                const distFromCenter = Math.abs(i - numPoints / 2) / (numPoints / 2);
                const dataIdx = Math.floor((1 - distFromCenter) * 32);
                const val = (prevZen[dataIdx] || 0) / 255;
                const waveH = Math.max(3, val * maxH * (1 - distFromCenter * 0.5));

                topPoints.push({ x: i * step, y: centerY - waveH });
                bottomPoints.push({ x: i * step, y: centerY + waveH });
              }

              ctx.shadowColor = accentColor;
              ctx.shadowBlur = 12;

              // Relleno translúcido
              ctx.beginPath();
              ctx.moveTo(topPoints[0].x, topPoints[0].y);
              for (let i = 1; i < numPoints; i++) {
                const prevP = topPoints[i - 1];
                const currP = topPoints[i];
                const midX = (prevP.x + currP.x) / 2;
                const midY = (prevP.y + currP.y) / 2;
                ctx.quadraticCurveTo(prevP.x, prevP.y, midX, midY);
              }
              ctx.lineTo(topPoints[numPoints - 1].x, topPoints[numPoints - 1].y);
              for (let i = numPoints - 1; i >= 0; i--) {
                ctx.lineTo(bottomPoints[i].x, bottomPoints[i].y);
              }
              ctx.closePath();

              const grad = ctx.createLinearGradient(0, centerY - maxH, 0, centerY + maxH);
              grad.addColorStop(0, 'rgba(0,0,0,0)');
              grad.addColorStop(0.5, accentColor);
              grad.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = grad;
              ctx.globalAlpha = 0.4;
              ctx.fill();
              ctx.globalAlpha = 1.0;

              // Líneas exteriores luminosas
              ctx.strokeStyle = accentColor;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(topPoints[0].x, topPoints[0].y);
              for (let i = 1; i < numPoints; i++) {
                const prevP = topPoints[i - 1];
                const currP = topPoints[i];
                const midX = (prevP.x + currP.x) / 2;
                const midY = (prevP.y + currP.y) / 2;
                ctx.quadraticCurveTo(prevP.x, prevP.y, midX, midY);
              }
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(bottomPoints[0].x, bottomPoints[0].y);
              for (let i = 1; i < numPoints; i++) {
                const prevP = bottomPoints[i - 1];
                const currP = bottomPoints[i];
                const midX = (prevP.x + currP.x) / 2;
                const midY = (prevP.y + currP.y) / 2;
                ctx.quadraticCurveTo(prevP.x, prevP.y, midX, midY);
              }
              ctx.stroke();
            } else if (mode === 'orbit') {
              // 72 rayos orbitales en 360 grados alrededor del centro
              const centerX = w / 2;
              const centerY = h / 2 - 20;
              const baseRadius = 220;
              const numRays = 72;

              ctx.strokeStyle = accentColor;
              ctx.lineWidth = 3;
              ctx.lineCap = 'round';
              ctx.shadowColor = accentColor;
              ctx.shadowBlur = 10;

              for (let i = 0; i < numRays; i++) {
                const angle = (i / numRays) * Math.PI * 2 - Math.PI / 2;
                const dataIdx = i < 36 ? i : (72 - i);
                const val = (prevZen[dataIdx] || 0) / 255;
                const rayLen = Math.max(6, val * 100);

                const x1 = centerX + Math.cos(angle) * baseRadius;
                const y1 = centerY + Math.sin(angle) * baseRadius;
                const x2 = centerX + Math.cos(angle) * (baseRadius + rayLen);
                const y2 = centerY + Math.sin(angle) * (baseRadius + rayLen);

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
              }
            } else if (mode === 'ambient') {
              // Resplandor atmosférico pulsante
              const centerX = w / 2;
              const centerY = h / 2 - 20;
              const bassVal = (prevZen[0] + prevZen[1] + prevZen[2] + prevZen[3]) / (4 * 255);
              const radius = 230 + bassVal * 170;

              const grad = ctx.createRadialGradient(centerX, centerY, 80, centerX, centerY, radius);
              grad.addColorStop(0, accentColor);
              grad.addColorStop(0.4, accentColor);
              grad.addColorStop(1, 'rgba(0,0,0,0)');

              ctx.fillStyle = grad;
              ctx.globalAlpha = 0.25 + bassVal * 0.45;
              ctx.fillRect(0, 0, w, h);
              ctx.globalAlpha = 1.0;
            }

            ctx.restore();
          }
        }
      }
      rafId = requestAnimationFrame(updateBars);
    };
    rafId = requestAnimationFrame(updateBars);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, liveBarsRef, pipLiveBarsRef, largeCanvasRef, largeSpectrumEnabled, prevSpectrumRef, zenCanvasRef, zenCoverRef, zenVisualConfig, isIdle]);

  useEffect(() => {
    if (!audioRef.current || isRoutedRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaElementSource(audioRef.current);
      isRoutedRef.current = true;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -0.5; // Limita suavemente antes de llegar a 0 dB
      compressor.knee.value = 5;
      compressor.ratio.value = 20;
      compressor.attack.value = 0.001;
      compressor.release.value = 0.1;

      const gainNode = ctx.createGain();
      gainNodeRef.current = gainNode;
      gainNode.gain.value = isMuted ? 0 : (volume / 100) * SAFE_MAX_VOLUME;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      source.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (err) {
      console.log('Error initializing AudioContext limiter:', err);
    }
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : (volume / 100) * SAFE_MAX_VOLUME;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    const handleWheelVolume = (e) => {
      const step = e.detail?.step ?? 1;
      const delta = e.detail?.deltaY;
      setVolume(prev => {
        let newVal = prev;
        if (delta < 0) newVal = Math.min(100, prev + step);
        else if (delta > 0) newVal = Math.max(0, prev - step);

        localStorage.setItem('musicPlayer_volume', newVal);
        if (audioRef.current && audioRef.current.muted && newVal > 0) {
          audioRef.current.muted = false;
        }
        if (audioRef.current) audioRef.current.volume = (newVal / 100) * SAFE_MAX_VOLUME;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('musicPlayer_volumeFeedback', {
            detail: { volume: newVal, isMuted: false }
          }));
        }, 0);
        return newVal;
      });
      if (delta < 0) setIsMuted(false);
    };
    window.addEventListener('musicPlayer_wheelVolume', handleWheelVolume);
    return () => window.removeEventListener('musicPlayer_wheelVolume', handleWheelVolume);
  }, []);

  useEffect(() => {
    setProgress(0);
    setCurrentTime(0);
    setFinalSpectrum(null);
    setSweepIndex(-1);

    if (!src || !activeSong) {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current.removeAttribute('src');
          audioRef.current.load();
        } catch (e) {}
      }
      setIsPlaying(false);
      if (onPlayStatusChange) onPlayStatusChange(false);
      if (zenPlaybackRefs?.bar?.current) zenPlaybackRefs.bar.current.style.width = '0%';
      if (zenPlaybackRefs?.screen?.current) zenPlaybackRefs.screen.current.style.width = '0%';
      if (zenPlaybackRefs?.ring?.current) zenPlaybackRefs.ring.current.style.strokeDashoffset = `${2 * Math.PI * 252}`;
      if (zenPlaybackRefs?.time?.current) zenPlaybackRefs.time.current.innerText = '--:--';
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        } catch (e) {}
      }
      return;
    }

    if (src && audioRef.current) {
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play().then(() => setIsPlaying(true)).catch(e => console.log('Autoplay prevented', e));
        }
      }, 50);
    }

    let cancelled = false;
    if (matrixIntervalRef.current) clearInterval(matrixIntervalRef.current);
    matrixIntervalRef.current = setInterval(() => {
      setSpectrum(prev => prev.map((v, i) => {
        const target = 30 + Math.sin(Date.now() / 200 + i / 10) * 20 + Math.random() * 15;
        return v * 0.5 + target * 0.5;
      }));
    }, 100);

    const analyze = async () => {
      try {
        const res = await fetch(src);
        const arrayBuffer = await res.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);

        const numBars = 250;
        const blockSize = Math.floor(channelData.length / numBars);
        const peaks = [];

        for (let i = 0; i < numBars; i++) {
          let max = 0;
          const start = i * blockSize;
          for (let j = 0; j < blockSize; j++) {
            const amplitude = Math.abs(channelData[start + j]);
            if (amplitude > max) max = amplitude;
          }
          peaks.push(max);
        }

        const maxPeak = Math.max(...peaks, 0.01);
        const finalData = peaks.map(p => {
          const power = Math.pow(p / maxPeak, 3);
          return Math.max(4, Math.min(100, power * 100));
        });

        if (!cancelled) {
          setFinalSpectrum(finalData);
          setSweepIndex(0);
        }
      } catch (err) {
        console.error("Error analyzing audio:", err);
        if (!cancelled) {
          setFinalSpectrum(Array.from({ length: 250 }, () => Math.random() * 60 + 20));
          setSweepIndex(0);
        }
      }
    };
    analyze();

    return () => {
      cancelled = true;
      if (matrixIntervalRef.current) clearInterval(matrixIntervalRef.current);
    };
  }, [src, activeSong]);

  useEffect(() => {
    if (sweepIndex >= 0 && finalSpectrum && sweepIndex < 250) {
      const sweepInterval = setInterval(() => {
        setSweepIndex(prev => {
          const next = prev + 3;
          if (next >= 250) {
            clearInterval(sweepInterval);
            if (matrixIntervalRef.current) clearInterval(matrixIntervalRef.current);
            return 250;
          }
          return next;
        });
      }, 16);
      return () => clearInterval(sweepInterval);
    }
  }, [sweepIndex, finalSpectrum]);

  const fadeOutTimeoutRef = useRef(null);

  const togglePlay = () => {
    if (!src && onPlayEmpty) {
      onPlayEmpty(isRandom);
      return;
    }
    if (audioRef.current && audioCtxRef.current && gainNodeRef.current) {
      const now = audioCtxRef.current.currentTime;
      const parsedVolume = Number(volume);
      const safeVolume = isNaN(parsedVolume) ? 25 : parsedVolume;
      const targetVolume = isMuted ? 0 : (safeVolume / 100) * SAFE_MAX_VOLUME;

      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }

      if (audioRef.current.paused) {
        if (fadeOutTimeoutRef.current) clearTimeout(fadeOutTimeoutRef.current);
        audioRef.current.play().catch(e => console.log('Play prevented', e));
        setIsPlaying(true);
        if (smoothFade) {
          gainNodeRef.current.gain.cancelScheduledValues(now);
          gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, now);
          gainNodeRef.current.gain.linearRampToValueAtTime(targetVolume, now + 0.15);
        } else {
          gainNodeRef.current.gain.cancelScheduledValues(now);
          gainNodeRef.current.gain.value = targetVolume;
        }
      } else {
        if (smoothFade) {
          gainNodeRef.current.gain.cancelScheduledValues(now);
          gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, now);
          gainNodeRef.current.gain.linearRampToValueAtTime(0, now + 0.15);
          fadeOutTimeoutRef.current = setTimeout(() => {
            if (audioRef.current) audioRef.current.pause();
          }, 150);
        } else {
          gainNodeRef.current.gain.cancelScheduledValues(now);
          gainNodeRef.current.gain.value = targetVolume;
          audioRef.current.pause();
        }
        setIsPlaying(false);
      }
    } else if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(e => console.log('Play prevented', e));
        setIsPlaying(true);
      } else {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const executePausePlayback = () => {
    if (fadeOutTimeoutRef.current) {
      clearTimeout(fadeOutTimeoutRef.current);
      fadeOutTimeoutRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (e) {
        console.warn('Error al pausar reproducción:', e);
      }
    }
    setIsPlaying(false);
    if (onPlayStatusChange) onPlayStatusChange(false);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused';
      } catch (e) {}
    }
  };

  const isDraggingRef = useRef(false);
  const rafRef = useRef(null);

  const updateSeek = (e) => {
    if (progressBarRef.current && audioRef.current) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percentage = clickX / rect.width;
      setProgress(percentage * 100);
      if (!isNaN(audioRef.current.duration)) {
        const newTime = percentage * audioRef.current.duration;
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      }
    }
  };

  useEffect(() => {
    const handleMove = (e) => {
      if (isDraggingRef.current) updateSeek(e);
    };
    const handleUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
      }

      // Interceptar F11 para sincronizar con la función de pantalla completa sin colisiones
      if (e.code === 'F11' || e.key === 'F11') {
        e.preventDefault();
        if (onToggleFullscreen) onToggleFullscreen();
        return;
      }

      // Ignorar si el usuario está escribiendo en el buscador
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;

      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const keyName = e.code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
      const keyStr = [...mods, keyName].join('+');

      if (keyStr === hotkeys.playPause) {
        e.preventDefault();
        togglePlay();
      } else if (keyStr === hotkeys.stop) {
        e.preventDefault();
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          setIsPlaying(false);
        }
      } else if (keyStr === hotkeys.nextTrack) {
        e.preventDefault();
        if (onNext) {
          const played = onNext(repeatMode, isRandom);
          if (played === false) setIsPlaying(false);
        }
      } else if (keyStr === hotkeys.prevTrack) {
        e.preventDefault();
        if (onPrev) {
          const played = onPrev(repeatMode, isRandom);
          if (played === false) setIsPlaying(false);
        }
      } else if (keyStr === hotkeys.forward) {
        e.preventDefault();
        if (audioRef.current && !isNaN(audioRef.current.duration)) {
          audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 5, audioRef.current.duration);
        }
      } else if (keyStr === hotkeys.rewind) {
        e.preventDefault();
        if (audioRef.current) {
          audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 5, 0);
        }
      } else if (keyStr === hotkeys.mute) {
        e.preventDefault();
        setIsMuted(prev => {
          const next = !prev;
          if (audioRef.current) audioRef.current.muted = next;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('musicPlayer_volumeFeedback', {
              detail: { volume, isMuted: next }
            }));
          }, 0);
          return next;
        });
      } else if (keyStr === hotkeys.random) {
        e.preventDefault();
        setIsRandom(prev => {
          localStorage.setItem('musicPlayer_random', String(!prev));
          return !prev;
        });
      } else if (keyStr === hotkeys.repeat) {
        e.preventDefault();
        setRepeatMode(prev => {
          const next = (prev + 1) % 3;
          localStorage.setItem('musicPlayer_repeat', next);
          return next;
        });
      } else if (keyStr === hotkeys.volUp) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('musicPlayer_wheelVolume', { detail: { deltaY: -1, step: 5 } }));
      } else if (keyStr === hotkeys.volDown) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('musicPlayer_wheelVolume', { detail: { deltaY: 1, step: 5 } }));
      } else if (keyStr === (hotkeys.favorite || 'L')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('musicPlayer_toggleCurrentFavorite'));
      } else if (keyStr === hotkeys.fullscreen) {
        e.preventDefault();
        if (onToggleFullscreen) onToggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onPrev, repeatMode, isRandom, hotkeys, onToggleFullscreen, volume]);

  useEffect(() => {
    const updateProgress = () => {
      if (audioRef.current && !isDraggingRef.current) {
        const current = audioRef.current.currentTime;
        const total = audioRef.current.duration;
        const pct = isNaN(total) || total === 0 ? 0 : (current / total) * 100;
        setCurrentTime(current);
        setDuration(total);
        setProgress(pct);

        if (onTimeProgressRef.current) {
          onTimeProgressRef.current({ currentTime: current, duration: total, progress: pct });
        }

        const zenRefs = zenPlaybackRefsRef.current;
        const zenConfig = zenVisualConfigRef.current;
        if (zenRefs) {
          if (zenRefs.bar?.current) {
            zenRefs.bar.current.style.width = `${pct}%`;
          }
          if (zenRefs.screen?.current) {
            zenRefs.screen.current.style.width = `${pct}%`;
          }
          if (zenRefs.ring?.current) {
            const circ = 2 * Math.PI * 252;
            const ratio = (isNaN(total) || total === 0) ? 0 : (current / total);
            zenRefs.ring.current.style.strokeDashoffset = `${(1 - ratio) * circ}`;
          }
          if (zenRefs.time?.current) {
            zenRefs.time.current.innerText = formatZenTime(current, total, zenConfig?.progressTiming || 'both');
          }
        }
      }
      rafRef.current = requestAnimationFrame(updateProgress);
    };

    if (isPlaying) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioRef.current && !isDraggingRef.current) {
        const cur = audioRef.current.currentTime;
        const tot = audioRef.current.duration;
        const p = (cur / tot) * 100 || 0;
        setCurrentTime(cur);
        setProgress(p);
        if (onTimeProgressRef.current) {
          onTimeProgressRef.current({ currentTime: cur, duration: tot, progress: p });
        }
      }
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    const onCustomSeek = (e) => {
      if (audioRef.current && !isNaN(audioRef.current.duration) && audioRef.current.duration > 0) {
        const pct = Math.max(0, Math.min(100, e.detail?.percentage || 0));
        const newTime = (pct / 100) * audioRef.current.duration;
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
        setProgress(pct);
        if (onTimeProgressRef.current) {
          onTimeProgressRef.current({ currentTime: newTime, duration: audioRef.current.duration, progress: pct });
        }
        const zenRefs = zenPlaybackRefsRef.current;
        const zenConfig = zenVisualConfigRef.current;
        if (zenRefs?.bar?.current) zenRefs.bar.current.style.width = `${pct}%`;
        if (zenRefs?.screen?.current) zenRefs.screen.current.style.width = `${pct}%`;
        if (zenRefs?.ring?.current) {
          const circ = 2 * Math.PI * 252;
          zenRefs.ring.current.style.strokeDashoffset = `${(1 - pct / 100) * circ}`;
        }
        if (zenRefs?.time?.current) {
          zenRefs.time.current.innerText = formatZenTime(newTime, audioRef.current.duration, zenConfig?.progressTiming || 'both');
        }
      }
    };
    window.addEventListener('musicPlayer_seek', onCustomSeek);
    return () => window.removeEventListener('musicPlayer_seek', onCustomSeek);
  }, []);

  useEffect(() => {
    const handleRemoteToggle = () => togglePlay();
    const handleRemoteStop = () => {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current.removeAttribute('src');
          audioRef.current.load();
        } catch (e) {}
      }
      setIsPlaying(false);
      if (onPlayStatusChange) onPlayStatusChange(false);
      setProgress(0);
      setCurrentTime(0);
      setDuration(0);
      if (zenPlaybackRefs?.bar?.current) zenPlaybackRefs.bar.current.style.width = '0%';
      if (zenPlaybackRefs?.screen?.current) zenPlaybackRefs.screen.current.style.width = '0%';
      if (zenPlaybackRefs?.ring?.current) zenPlaybackRefs.ring.current.style.strokeDashoffset = `${2 * Math.PI * 252}`;
      if (zenPlaybackRefs?.time?.current) zenPlaybackRefs.time.current.innerText = '--:--';
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        } catch (e) {}
      }
    };
    const handleRemoteForward = () => {
      if (audioRef.current && !isNaN(audioRef.current.duration)) {
        audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 5, audioRef.current.duration);
      }
    };
    const handleRemoteRewind = () => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 5, 0);
      }
    };
    const handleRemoteMute = () => {
      setIsMuted(prev => {
        const next = !prev;
        if (audioRef.current) audioRef.current.muted = next;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('musicPlayer_volumeFeedback', {
            detail: { volume, isMuted: next }
          }));
        }, 0);
        return next;
      });
    };

    window.addEventListener('musicPlayer_togglePlay', handleRemoteToggle);
    window.addEventListener('musicPlayer_stop', handleRemoteStop);
    window.addEventListener('musicPlayer_forward', handleRemoteForward);
    window.addEventListener('musicPlayer_rewind', handleRemoteRewind);
    window.addEventListener('musicPlayer_toggleMute', handleRemoteMute);
    return () => {
      window.removeEventListener('musicPlayer_togglePlay', handleRemoteToggle);
      window.removeEventListener('musicPlayer_stop', handleRemoteStop);
      window.removeEventListener('musicPlayer_forward', handleRemoteForward);
      window.removeEventListener('musicPlayer_rewind', handleRemoteRewind);
      window.removeEventListener('musicPlayer_toggleMute', handleRemoteMute);
    };
  }, [togglePlay, volume]);

  const handleTimeUpdate = () => {
    if (audioRef.current && !isPlaying && !isDraggingRef.current) {
      const current = audioRef.current.currentTime;
      const total = audioRef.current.duration;
      const pct = isNaN(total) || total === 0 ? 0 : (current / total) * 100;
      setCurrentTime(current);
      setDuration(total);
      setProgress(pct);
      if (onTimeProgressRef.current) {
        onTimeProgressRef.current({ currentTime: current, duration: total, progress: pct });
      }
      const zenRefs = zenPlaybackRefsRef.current;
      const zenConfig = zenVisualConfigRef.current;
      if (zenRefs?.time?.current) {
        zenRefs.time.current.innerText = formatZenTime(current, total, zenConfig?.progressTiming || 'both');
      }
    }
  };

  const handleSeek = (e) => {
    if (progressBarRef.current && audioRef.current) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      const newTime = percentage * audioRef.current.duration;
      audioRef.current.currentTime = newTime;
      setProgress(percentage * 100);
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = (val / 100) * SAFE_MAX_VOLUME;
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (audioRef.current) {
      audioRef.current.muted = next;
    }
    window.dispatchEvent(new CustomEvent('musicPlayer_volumeFeedback', {
      detail: { volume, isMuted: next }
    }));
  };

  const handleStop = () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      } catch (e) {}
    }
    setIsPlaying(false);
    if (onPlayStatusChange) onPlayStatusChange(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    if (zenPlaybackRefs?.bar?.current) zenPlaybackRefs.bar.current.style.width = '0%';
    if (zenPlaybackRefs?.screen?.current) zenPlaybackRefs.screen.current.style.width = '0%';
    if (zenPlaybackRefs?.ring?.current) zenPlaybackRefs.ring.current.style.strokeDashoffset = `${2 * Math.PI * 252}`;
    if (zenPlaybackRefs?.time?.current) zenPlaybackRefs.time.current.innerText = formatZenTime(0, 0, zenVisualConfig?.progressTiming || 'both');
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      } catch (e) {}
    }
    if (onStop) onStop();
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      audioRef.current.volume = (volume / 100) * SAFE_MAX_VOLUME;
      audioRef.current.muted = isMuted;
      consecutiveErrorsRef.current = 0;
    }
  };

  const handleAudioError = () => {
    if (!src) return;
    const mediaError = audioRef.current?.error;
    let errorMsg = 'Error al decodificar la pista.';
    if (mediaError) {
      if (mediaError.code === 1) errorMsg = 'Reproducción abortada.';
      else if (mediaError.code === 2) errorMsg = 'Fallo al leer archivo local.';
      else if (mediaError.code === 3) errorMsg = 'Archivo de audio dañado o formato no decodificable.';
      else if (mediaError.code === 4) errorMsg = 'Formato no soportado por el navegador.';
    }

    const songTitle = activeSong?.title ? `"${activeSong.title}"` : 'la pista actual';
    consecutiveErrorsRef.current += 1;

    if (consecutiveErrorsRef.current <= 4) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: {
          message: `${errorMsg} Saltando ${songTitle}...`,
          isError: true,
          duration: 3800
        }
      }));

      setTimeout(() => {
        if (onNext) {
          const played = onNext(repeatMode, isRandom);
          if (played === false) setIsPlaying(false);
        }
      }, 750);
    } else {
      setIsPlaying(false);
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: {
          message: 'Se detuvo la reproducción tras múltiples archivos no compatibles o dañados.',
          isError: true,
          duration: 5000
        }
      }));
    }
  };

  // Click outside para cerrar el menú de temporizador y el menú de cola
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sleepTimerMenuRef.current && !sleepTimerMenuRef.current.contains(e.target)) {
        setShowSleepTimerMenu(false);
      }
      if (queueMenuRef.current && !queueMenuRef.current.contains(e.target)) {
        setShowQueueMenu(false);
      }
    };
    if (showSleepTimerMenu || showQueueMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSleepTimerMenu, showQueueMenu]);

  // Escuchar petición global de pausa al completarse el temporizador de apagado
  useEffect(() => {
    const handleRequestPause = () => {
      executePausePlayback();
      // Restaurar volumen en el gainNode para cuando se vuelva a reproducir en el futuro
      if (gainNodeRef.current && audioCtxRef.current) {
        const now = audioCtxRef.current.currentTime;
        const parsedVolume = Number(volume);
        const safeVolume = isNaN(parsedVolume) ? 25 : parsedVolume;
        const targetVolume = isMuted ? 0 : (safeVolume / 100) * SAFE_MAX_VOLUME;
        gainNodeRef.current.gain.cancelScheduledValues(now);
        gainNodeRef.current.gain.setValueAtTime(targetVolume, now + 0.05);
      }
      sleepFadeStartedRef.current = false;
    };
    window.addEventListener('musicPlayer_requestPausePlayback', handleRequestPause);
    return () => window.removeEventListener('musicPlayer_requestPausePlayback', handleRequestPause);
  }, [volume, isMuted, SAFE_MAX_VOLUME]);

  // Temporizador de Apagado: Desvanecimiento suave de audio en los últimos segundos
  useEffect(() => {
    if (!sleepTimer?.active || sleepTimer?.mode !== 'time' || sleepTimer?.remainingSeconds === null) {
      sleepFadeStartedRef.current = false;
      return;
    }

    // Iniciar desvanecimiento gradual según los segundos configurados si está reproduciendo
    const fadeDuration = typeof sleepTimerFadeSeconds === 'number' ? sleepTimerFadeSeconds : (parseInt(sleepTimerFadeSeconds, 10) || 5);
    if (fadeDuration > 0 && sleepTimer.remainingSeconds <= fadeDuration && sleepTimer.remainingSeconds > 0 && isPlaying && !sleepFadeStartedRef.current) {
      if (gainNodeRef.current && audioCtxRef.current) {
        const now = audioCtxRef.current.currentTime;
        sleepFadeStartedRef.current = true;
        gainNodeRef.current.gain.cancelScheduledValues(now);
        gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, now);
        gainNodeRef.current.gain.linearRampToValueAtTime(0.0001, now + sleepTimer.remainingSeconds);
      }
    }
  }, [sleepTimer?.active, sleepTimer?.mode, sleepTimer?.remainingSeconds, sleepTimerFadeSeconds, isPlaying]);

  // Restaurar volumen si el usuario desactiva el temporizador durante el fade
  useEffect(() => {
    if ((!sleepTimer?.active || sleepTimer?.mode === 'off') && gainNodeRef.current && audioCtxRef.current) {
      sleepFadeStartedRef.current = false;
      const now = audioCtxRef.current.currentTime;
      const parsedVolume = Number(volume);
      const safeVolume = isNaN(parsedVolume) ? 25 : parsedVolume;
      const targetVolume = isMuted ? 0 : (safeVolume / 100) * SAFE_MAX_VOLUME;
      gainNodeRef.current.gain.cancelScheduledValues(now);
      gainNodeRef.current.gain.setValueAtTime(targetVolume, now + 0.05);
    }
  }, [sleepTimer?.active, sleepTimer?.mode]);

  // 1. Integración con navigator.mediaSession: Metadatos y carátula
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (activeSong) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: activeSong.title || 'Pista desconocida',
          artist: activeSong.artist || 'Artista desconocido',
          album: activeSong.album || 'Álbum desconocido',
          artwork: activeSong.cover ? [
            { src: activeSong.cover, sizes: '96x96', type: 'image/jpeg' },
            { src: activeSong.cover, sizes: '128x128', type: 'image/jpeg' },
            { src: activeSong.cover, sizes: '256x256', type: 'image/jpeg' },
            { src: activeSong.cover, sizes: '512x512', type: 'image/jpeg' }
          ] : []
        });
      } catch (e) {
        console.warn('Error setting MediaMetadata:', e);
      }
    } else {
      navigator.mediaSession.metadata = null;
    }
  }, [activeSong]);

  // navigator.mediaSession: Estado de reproducción
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // navigator.mediaSession: Posición y duración
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (duration > 0 && !isNaN(duration) && !isNaN(currentTime)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, duration),
          playbackRate: 1,
          position: Math.min(Math.max(0, currentTime), duration)
        });
      } catch (e) { }
    }
  }, [currentTime, duration]);

  // navigator.mediaSession: Control de botones físicos y teclas multimedia del sistema
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers = [
      ['play', () => { if (!isPlaying) togglePlay(); }],
      ['pause', () => { if (isPlaying) togglePlay(); }],
      ['previoustrack', () => {
        if (onPrev) {
          const played = onPrev(repeatMode, isRandom);
          if (played === false) setIsPlaying(false);
        }
      }],
      ['nexttrack', () => {
        if (onNext) {
          const played = onNext(repeatMode, isRandom);
          if (played === false) setIsPlaying(false);
        }
      }],
      ['stop', () => { handleStop(); }],
      ['seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        if (audioRef.current) {
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - offset);
        }
      }],
      ['seekforward', (details) => {
        const offset = details.seekOffset || 10;
        if (audioRef.current && !isNaN(audioRef.current.duration)) {
          audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime + offset);
        }
      }],
      ['seekto', (details) => {
        if (details.seekTime != null && audioRef.current && !isNaN(audioRef.current.duration)) {
          audioRef.current.currentTime = Math.min(Math.max(0, details.seekTime), audioRef.current.duration);
        }
      }]
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) { }
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (e) { }
      }
    };
  }, [isPlaying, onNext, onPrev, onStop, repeatMode, isRandom]);

  return (
    <div
      onWheel={(e) => {
        if (e.target.type === 'range') return;
        window.dispatchEvent(new CustomEvent('musicPlayer_wheelVolume', { detail: { deltaY: e.deltaY } }));
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: 'var(--bg-secondary)', padding: '8px 24px', borderTop: '1px solid var(--border-color)', flexShrink: 0, zIndex: 100, boxShadow: '0 -4px 20px rgba(0,0,0,0.2)' }}
    >
      <audio
        style={{ display: 'none' }}
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onError={handleAudioError}
        onEnded={() => {
          if (sleepTimer?.active && sleepTimer?.mode === 'tracks') {
            const currentRem = sleepTimer.remainingTracks;
            if (currentRem <= 1) {
              executePausePlayback();
              if (onCancelSleepTimer) onCancelSleepTimer();
              window.dispatchEvent(new CustomEvent('musicPlayer_sleepTimerFinished'));
              window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
                detail: { message: 'Temporizador completado: Se ha alcanzado el límite de canciones reproducidas. ¡Buenas noches!' }
              }));
              return;
            } else {
              if (onDecrementSleepTimerTracks) onDecrementSleepTimerTracks();
            }
          }
          if (onNext) {
            const played = onNext(repeatMode, isRandom);
            if (played === false) executePausePlayback();
          } else executePausePlayback();
        }}
      ></audio>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0px' }}>
        {/* Volumen (Izquierda) */}
        <div style={{ width: '150px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px' }}>
          <button className="player-btn" onClick={toggleMute} style={{ background: (isMuted || volume === 0) ? 'rgba(255,255,255,0.08)' : 'none', color: (isMuted || volume === 0) ? 'var(--accent-color)' : 'var(--text-secondary)', flexShrink: 0 }} title="Silenciar">
            {(isMuted || volume === 0) ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          <input
            type="range"
            min="0" max="100" step="1"
            value={volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              localStorage.setItem('musicPlayer_volume', val);
              if (isMuted) {
                setIsMuted(false);
                if (audioRef.current) audioRef.current.muted = false;
              }
              if (audioRef.current) audioRef.current.volume = (val / 100) * SAFE_MAX_VOLUME;
              window.dispatchEvent(new CustomEvent('musicPlayer_volumeFeedback', {
                detail: { volume: val, isMuted: false }
              }));
            }}
            className="styled-slider"
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', width: '26px', textAlign: 'right', userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>
            {volume}%
          </span>
        </div>

        {/* Controles (Centro Perfecto) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button className="player-btn" onClick={() => {
            const newR = !isRandom;
            setIsRandom(newR);
            localStorage.setItem('musicPlayer_random', newR);
          }} style={{ background: isRandom ? 'rgba(255,255,255,0.08)' : 'none', color: isRandom ? 'var(--accent-color)' : 'var(--text-secondary)' }} title="Aleatorio">
            <Shuffle size={14} />
          </button>

          <button className="player-btn" onClick={() => {
            if (onPrev) {
              const played = onPrev(repeatMode, isRandom);
              if (played === false) setIsPlaying(false);
            }
          }} title="Anterior">
            <SkipBack size={18} />
          </button>

          <button onClick={togglePlay} className="play-btn-anim" style={{ width: '40px', height: '40px', flexShrink: 0, background: 'var(--accent-color)', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', transition: 'background 0.2s, transform 0.1s', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} title="Reproducir / Pausar">
            {isPlaying ? <Pause key="pause" size={18} style={{ animation: 'pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }} /> : <Play key="play" size={18} style={{ marginLeft: '2px', animation: 'pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }} />}
          </button>

          <button className="player-btn" onClick={() => {
            if (onNext) {
              const played = onNext(repeatMode, isRandom);
              if (played === false) setIsPlaying(false);
            }
          }} title="Siguiente">
            <SkipForward size={18} />
          </button>

          <button className="player-btn" onClick={() => {
            const newRM = (repeatMode + 1) % 3;
            setRepeatMode(newRM);
            localStorage.setItem('musicPlayer_repeat', newRM);
          }} style={{ position: 'relative', background: repeatMode > 0 ? 'rgba(255,255,255,0.08)' : 'none', color: repeatMode > 0 ? 'var(--accent-color)' : 'var(--text-secondary)' }} title={repeatMode === 2 ? "Repetir Pista Actual" : repeatMode === 1 ? "Repetir Todo" : "Repetir Pista"}>
            <Repeat size={14} />
            {repeatMode === 2 && <span style={{ position: 'absolute', top: '0', right: '0', fontSize: '8px', fontWeight: 'bold', backgroundColor: 'var(--bg-tertiary)', borderRadius: '50%', width: '12px', height: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>1</span>}
          </button>
        </div>

        {/* Controles Derecha: Cola de reproducción, Sleep Timer, Fullscreen y Stop */}
        <div style={{ minWidth: '160px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
          {/* Botón Cola de Reproducción con Popover */}
          <div style={{ position: 'relative' }} ref={queueMenuRef}>
            <button
              className="player-btn"
              onClick={() => setShowQueueMenu(prev => !prev)}
              title={playQueue && playQueue.length > 0 ? `Cola de reproducción (${playQueue.length} pistas en espera)` : "Cola de reproducción"}
              style={{
                background: showQueueMenu || (playQueue && playQueue.length > 0) ? 'color-mix(in srgb, var(--accent-color) 15%, transparent)' : 'none',
                color: showQueueMenu || (playQueue && playQueue.length > 0) ? 'var(--accent-color)' : 'var(--text-secondary)',
                border: (playQueue && playQueue.length > 0) ? '1px solid color-mix(in srgb, var(--accent-color) 40%, transparent)' : '1px solid transparent',
                borderRadius: '6px',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 6px'
              }}
            >
              <ListOrdered size={14} />
              {playQueue && playQueue.length > 0 && (
                <span style={{ fontSize: '9px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', padding: '0 2px' }}>
                  {playQueue.length}
                </span>
              )}
            </button>

            {showQueueMenu && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 12px)',
                  right: 0,
                  width: '320px',
                  maxHeight: '440px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6)',
                  backdropFilter: 'blur(20px)',
                  zIndex: 1000,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  animation: 'fadeInScale 0.15s ease-out'
                }}
              >
                {/* Header Cola */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ListOrdered size={15} style={{ color: 'var(--accent-color)' }} />
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-highlight)' }}>Cola de Reproducción</span>
                    {playQueue.length > 0 && (
                      <span style={{ fontSize: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: '1px 6px', borderRadius: '10px', color: 'var(--text-secondary)' }}>
                        {playQueue.length}
                      </span>
                    )}
                  </div>
                  {playQueue.length > 0 && (
                    <button
                      onClick={() => {
                        if (onClearQueue) onClearQueue();
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#f87171',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      title="Vaciar la cola"
                    >
                      <Trash2 size={12} /> Limpiar
                    </button>
                  )}
                </div>

                <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Sonando Ahora */}
                  {activeSong && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '6px' }}>
                        Sonando Ahora
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'color-mix(in srgb, var(--accent-color) 8%, var(--bg-tertiary))', border: '1px solid color-mix(in srgb, var(--accent-color) 25%, transparent)', padding: '8px 10px', borderRadius: '6px' }}>
                        {activeSong.cover ? (
                          <img src={activeSong.cover} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Disc3 size={16} opacity={0.3} />
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {activeSong.title}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {activeSong.artist}
                          </div>
                        </div>
                        <Activity size={14} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                      </div>
                    </div>
                  )}

                  {/* A Continuación */}
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '6px' }}>
                      A Continuación ({playQueue.length})
                    </div>
                    {playQueue.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-secondary)', fontSize: '11px', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                        <ListOrdered size={24} opacity={0.2} style={{ marginBottom: '6px' }} />
                        <div>La cola prioritaria está vacía.</div>
                        <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>
                          Haz clic derecho sobre cualquier pista para «Reproducir a continuación» o «Añadir a la cola».
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {playQueue.map((track, idx) => (
                          <div
                            key={`queue-${track.id}-${idx}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              background: 'var(--bg-tertiary)',
                              padding: '6px 8px',
                              borderRadius: '5px',
                              border: '1px solid var(--border-color)',
                              transition: 'background 0.15s'
                            }}
                          >
                            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', width: '14px', textAlign: 'center', fontWeight: 600 }}>
                              {idx + 1}
                            </span>
                            {track.cover ? (
                              <img src={track.cover} alt="" style={{ width: '28px', height: '28px', borderRadius: '4px', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Disc3 size={14} opacity={0.25} />
                              </div>
                            )}
                            <div
                              style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                              onClick={() => {
                                if (onPlayFromQueue) onPlayFromQueue(idx);
                              }}
                              title="Reproducir ahora esta canción"
                            >
                              <div style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--text-highlight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {track.title}
                              </div>
                              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {track.artist}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                              {idx > 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); if (onMoveQueueItem) onMoveQueueItem(idx, idx - 1); }}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                                  title="Subir en la cola"
                                >
                                  <ArrowUp size={12} />
                                </button>
                              )}
                              {idx < playQueue.length - 1 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); if (onMoveQueueItem) onMoveQueueItem(idx, idx + 1); }}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                                  title="Bajar en la cola"
                                >
                                  <ArrowDown size={12} />
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); if (onRemoveFromQueue) onRemoveFromQueue(idx); }}
                                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', marginLeft: '2px' }}
                                title="Quitar de la cola"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Toggle Modo Zen Automático */}
          <button
            className={`player-btn ${idleModeEnabled ? 'active' : ''}`}
            onClick={onToggleIdleMode}
            title={idleModeEnabled ? "Modo Zen automático activado (clic para desactivar)" : "Modo Zen automático desactivado (clic para activar)"}
            style={idleModeEnabled ? {
              color: 'var(--accent-color)',
              background: 'color-mix(in srgb, var(--accent-color) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-color) 40%, transparent)',
              borderRadius: '6px',
              padding: '4px 6px'
            } : {
              color: 'var(--text-secondary)',
              border: '1px solid transparent',
              borderRadius: '6px',
              padding: '4px 6px'
            }}
          >
            <Sparkles size={14} />
          </button>

          {/* 3. Toggle Mini-Reproductor Automático */}
          <button
            className={`player-btn ${pipAutoOpen ? 'active' : ''}`}
            onClick={onTogglePipAutoOpen}
            title={pipAutoOpen ? "Mini-reproductor automático activado (clic para desactivar)" : "Mini-reproductor automático desactivado (clic para activar)"}
            style={pipAutoOpen ? {
              color: 'var(--accent-color)',
              background: 'color-mix(in srgb, var(--accent-color) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-color) 40%, transparent)',
              borderRadius: '6px',
              padding: '4px 6px'
            } : {
              color: 'var(--text-secondary)',
              border: '1px solid transparent',
              borderRadius: '6px',
              padding: '4px 6px'
            }}
          >
            <PictureInPicture2 size={14} />
          </button>

          {/* 4. Botón Temporizador de Apagado con Popover */}
          <div style={{ position: 'relative' }} ref={sleepTimerMenuRef}>
            <button
              className="player-btn"
              onClick={() => setShowSleepTimerMenu(prev => !prev)}
              title={
                sleepTimer?.active
                  ? (sleepTimer.mode === 'time'
                      ? `Temporizador activo (Quedan ${formatSleepTime(sleepTimer.remainingSeconds)})`
                      : `Temporizador activo (Quedan ${sleepTimer.remainingTracks} canciones)`)
                  : "Temporizador de apagado"
              }
              style={{
                background: sleepTimer?.active ? 'color-mix(in srgb, var(--accent-color) 15%, transparent)' : 'none',
                color: sleepTimer?.active ? 'var(--accent-color)' : 'var(--text-secondary)',
                border: sleepTimer?.active ? '1px solid color-mix(in srgb, var(--accent-color) 40%, transparent)' : '1px solid transparent',
                borderRadius: '6px',
                position: 'relative',
                gap: '4px',
                display: 'flex',
                alignItems: 'center',
                padding: '4px 6px'
              }}
            >
              <Moon size={14} />
              {sleepTimer?.active && sleepTimer?.mode === 'time' && sleepTimer?.remainingSeconds > 0 && (
                <span style={{ fontSize: '9px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {formatBadgeTime(sleepTimer.remainingSeconds)}
                </span>
              )}
              {sleepTimer?.active && sleepTimer?.mode === 'tracks' && (
                <span style={{ fontSize: '9px', fontWeight: 600 }}>
                  {sleepTimer.remainingTracks === 1 ? '1♫' : `${sleepTimer.remainingTracks}♫`}
                </span>
              )}
            </button>

            {showSleepTimerMenu && (
              <div
                className="sleep-timer-popover"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 10px)',
                  right: 0,
                  width: '310px',
                  background: 'var(--bg-secondary)',
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '14px',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.65), 0 0 1px 1px var(--border-color)',
                  zIndex: 10002,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 600, color: 'var(--text-highlight)' }}>
                    <Moon size={15} style={{ color: 'var(--accent-color)' }} />
                    <span>Temporizador de Apagado</span>
                  </div>
                  <button
                    onClick={() => setShowSleepTimerMenu(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', borderRadius: '4px' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--text-highlight)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Banner de estado activo */}
                {sleepTimer?.active && (
                  <div style={{
                    padding: '8px 10px',
                    background: 'color-mix(in srgb, var(--accent-color) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-color) 35%, transparent)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: 'var(--accent-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
                      <Timer size={13} />
                      <span>
                        {sleepTimer.mode === 'time'
                          ? `Apagado en ${formatSleepTime(sleepTimer.remainingSeconds)}`
                          : `Apagado tras ${sleepTimer.remainingTracks} ${sleepTimer.remainingTracks === 1 ? 'canción' : 'canciones'}`}
                      </span>
                    </div>
                    <button
                      className="btn btn-outline"
                      onClick={() => {
                        if (onCancelSleepTimer) onCancelSleepTimer();
                      }}
                      style={{
                        padding: '2px 8px',
                        fontSize: '10px',
                        color: 'var(--text-highlight)',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                {/* Pestañas de modo: Por Tiempo / Por Canciones */}
                <div style={{
                  display: 'flex',
                  gap: '4px',
                  background: 'var(--bg-tertiary)',
                  padding: '3px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <button
                    onClick={() => setSleepPopoverTab('time')}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontSize: '11px',
                      fontWeight: sleepPopoverTab === 'time' ? 600 : 400,
                      color: sleepPopoverTab === 'time' ? 'var(--text-highlight)' : 'var(--text-secondary)',
                      background: sleepPopoverTab === 'time' ? 'color-mix(in srgb, var(--accent-color) 18%, transparent)' : 'transparent',
                      border: sleepPopoverTab === 'time' ? '1px solid color-mix(in srgb, var(--accent-color) 40%, transparent)' : '1px solid transparent',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      transition: 'all 0.15s'
                    }}
                  >
                    <Clock size={12} style={{ color: sleepPopoverTab === 'time' ? 'var(--accent-color)' : 'inherit' }} />
                    <span>Por Tiempo</span>
                  </button>
                  <button
                    onClick={() => setSleepPopoverTab('tracks')}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontSize: '11px',
                      fontWeight: sleepPopoverTab === 'tracks' ? 600 : 400,
                      color: sleepPopoverTab === 'tracks' ? 'var(--text-highlight)' : 'var(--text-secondary)',
                      background: sleepPopoverTab === 'tracks' ? 'color-mix(in srgb, var(--accent-color) 18%, transparent)' : 'transparent',
                      border: sleepPopoverTab === 'tracks' ? '1px solid color-mix(in srgb, var(--accent-color) 40%, transparent)' : '1px solid transparent',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      transition: 'all 0.15s'
                    }}
                  >
                    <Music size={12} style={{ color: sleepPopoverTab === 'tracks' ? 'var(--accent-color)' : 'inherit' }} />
                    <span>Por Canciones</span>
                  </button>
                </div>

                {/* Contenido Pestaña Por Tiempo */}
                {sleepPopoverTab === 'time' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                      Marcas rápidas
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                      {[
                        { sec: 15 * 60, label: '15m' },
                        { sec: 30 * 60, label: '30m' },
                        { sec: 45 * 60, label: '45m' },
                        { sec: 60 * 60, label: '1 hora' },
                        { sec: 2 * 3600, label: '2 horas' },
                        { sec: 4 * 3600, label: '4 horas' },
                        { sec: 8 * 3600, label: '8 horas' },
                      ].map(preset => {
                        const isSelected = sleepTimer?.active && sleepTimer?.mode === 'time' && Math.abs((sleepTimer.remainingSeconds || 0) - preset.sec) < 5;
                        return (
                          <button
                            key={preset.sec}
                            onClick={() => {
                              if (onActivateSleepTimerByTime) onActivateSleepTimerByTime(preset.sec, preset.label);
                              setShowSleepTimerMenu(false);
                            }}
                            style={{
                              padding: '6px 4px',
                              fontSize: '11px',
                              borderRadius: '6px',
                              background: isSelected ? 'color-mix(in srgb, var(--accent-color) 20%, transparent)' : 'var(--bg-tertiary)',
                              color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
                              border: isSelected ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
                              cursor: 'pointer',
                              textAlign: 'center',
                              fontWeight: isSelected ? 600 : 400,
                              transition: 'all 0.15s'
                            }}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => {
                          if (onCancelSleepTimer) onCancelSleepTimer();
                          setShowSleepTimerMenu(false);
                        }}
                        style={{
                          padding: '6px 4px',
                          fontSize: '11px',
                          borderRadius: '6px',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-color)',
                          cursor: 'pointer',
                          textAlign: 'center',
                          transition: 'all 0.15s'
                        }}
                        title="Desactivar temporizador"
                      >
                        Apagar
                      </button>
                    </div>

                    {/* Ajuste Manual Horas y Minutos */}
                    <div style={{
                      marginTop: '2px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                        Ajuste Manual
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            placeholder="0"
                            value={customHours}
                            onChange={e => setCustomHours(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '5px 6px',
                              background: 'var(--bg-tertiary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              color: 'var(--text-primary)',
                              fontSize: '12px',
                              textAlign: 'center'
                            }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>h</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                          <input
                            type="number"
                            min="0"
                            max="59"
                            placeholder="30"
                            value={customMinutes}
                            onChange={e => setCustomMinutes(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '5px 6px',
                              background: 'var(--bg-tertiary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              color: 'var(--text-primary)',
                              fontSize: '12px',
                              textAlign: 'center'
                            }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>m</span>
                        </div>
                        <button
                          onClick={() => {
                            const h = parseInt(customHours, 10) || 0;
                            const m = parseInt(customMinutes, 10) || 0;
                            const totalSecs = (h * 3600) + (m * 60);
                            if (totalSecs > 0) {
                              if (onActivateSleepTimerByTime) {
                                onActivateSleepTimerByTime(totalSecs, `${h > 0 ? `${h}h ` : ''}${m}m`);
                              }
                              setShowSleepTimerMenu(false);
                            }
                          }}
                          className="btn"
                          style={{
                            padding: '6px 12px',
                            fontSize: '11px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Iniciar
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Contenido Pestaña Por Canciones */}
                {sleepPopoverTab === 'tracks' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                      Marcas de canciones
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {[
                        { tracks: 1, label: 'Al terminar canción actual' },
                        { tracks: 2, label: 'Tras 2 canciones' },
                        { tracks: 3, label: 'Tras 3 canciones' },
                        { tracks: 5, label: 'Tras 5 canciones' },
                        { tracks: 10, label: 'Tras 10 canciones' },
                      ].map(preset => {
                        const isSelected = sleepTimer?.active && sleepTimer?.mode === 'tracks' && sleepTimer.remainingTracks === preset.tracks;
                        return (
                          <button
                            key={preset.tracks}
                            onClick={() => {
                              if (onActivateSleepTimerByTracks) onActivateSleepTimerByTracks(preset.tracks);
                              setShowSleepTimerMenu(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              fontSize: '11px',
                              borderRadius: '6px',
                              background: isSelected ? 'color-mix(in srgb, var(--accent-color) 20%, transparent)' : 'var(--bg-tertiary)',
                              color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
                              border: isSelected ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
                              cursor: 'pointer',
                              transition: 'all 0.15s'
                            }}
                          >
                            <span>{preset.label}</span>
                            {isSelected && <span style={{ fontSize: '10px' }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>

                    {/* Ajuste Manual Pistas */}
                    <div style={{
                      marginTop: '2px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                        Cantidad manual de canciones
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          placeholder="Ej: 7"
                          value={customTracks}
                          onChange={e => setCustomTracks(e.target.value)}
                          style={{
                            flex: 1,
                            padding: '5px 8px',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: 'var(--text-primary)',
                            fontSize: '12px'
                          }}
                        />
                        <button
                          onClick={() => {
                            const val = parseInt(customTracks, 10);
                            if (val > 0) {
                              if (onActivateSleepTimerByTracks) onActivateSleepTimerByTracks(val);
                              setShowSleepTimerMenu(false);
                            }
                          }}
                          className="btn"
                          style={{
                            padding: '6px 12px',
                            fontSize: '11px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Iniciar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            className="player-btn"
            onClick={onToggleFullscreen}
            title={isFullscreen ? "Salir de Pantalla Completa (F)" : "Pantalla Completa (F)"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="player-btn" onClick={handleStop} title="Detener por completo">
            <Square size={14} />
          </button>
        </div>
      </div>

      {/* Tiempos */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', userSelect: 'none', padding: '0 2px' }}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Barra de Progreso - Espectro Musical Continuo y Arrastrable */}
      <div
        ref={progressBarRef}
        style={{ position: 'relative', width: '100%', height: '24px', cursor: 'pointer' }}
        onPointerDown={(e) => {
          isDraggingRef.current = true;
          updateSeek(e);
          e.target.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          e.target.releasePointerCapture(e.pointerId);
        }}
      >
        {/* Capa Base (Gris) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1px', width: '100%', height: '100%', pointerEvents: 'none' }}>
          {spectrum.map((v, i) => {
            const height = (sweepIndex >= 0 && finalSpectrum && i < sweepIndex) ? finalSpectrum[i] : v;
            return <div key={`bg-${i}`} style={{ flex: 1, height: `${height}%`, backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px', transition: 'height 0.2s', pointerEvents: 'none' }} />
          })}
        </div>

        {/* Capa Activa (Luz Azul con revelado suave) */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '1px', width: '100%', height: '100%', clipPath: `inset(0 ${100 - progress}% 0 0)`, pointerEvents: 'none' }}>
          {spectrum.map((v, i) => {
            const height = (sweepIndex >= 0 && finalSpectrum && i < sweepIndex) ? finalSpectrum[i] : v;
            return <div key={`fg-${i}`} style={{ flex: 1, height: `${height}%`, backgroundColor: 'var(--accent-color)', borderRadius: '12px', transition: 'height 0.2s', pointerEvents: 'none' }} />
          })}
        </div>
      </div>
    </div>
  );
};

const InspectorDetailsContent = ({ song, isFavorite, onToggleFavorite }) => {
  if (!song) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', textAlign: 'center', gap: '16px', padding: '20px' }}>
        <Disc3 size={48} opacity={0.15} />
        <span style={{ fontSize: '12px' }}>Selecciona una pista para inspeccionar sus detalles.</span>
      </div>
    );
  }
  return (
    <>
      <div className="inspector-cover-wrapper">
        {song.cover ? (
          <img
            src={song.cover}
            alt="Cover"
            className="inspector-cover"
            style={{
              objectFit: song.isSquareCover ? 'cover' : 'contain'
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
            <Disc3 size={60} opacity={0.2} />
          </div>
        )}
      </div>

      <div className="prop-row" style={{ width: '100%', minWidth: 0, marginBottom: '10px' }}>
        <span className="prop-label">Título</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0 }}>
          <span
            className="prop-val"
            style={{
              fontSize: '15px',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
              display: 'block'
            }}
            title={song.title}
          >
            {song.title}
          </span>
          {onToggleFavorite && (
            <button
              className={`heart-btn ${isFavorite ? 'is-fav' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              title={isFavorite ? "Quitar de favoritos (L)" : "Añadir a favoritos (L)"}
              style={{
                padding: '4px',
                borderRadius: '6px',
                color: isFavorite ? '#f43f5e' : 'var(--text-secondary)',
                background: isFavorite ? 'color-mix(in srgb, #f43f5e 12%, transparent)' : 'transparent',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                cursor: 'pointer',
                transition: 'transform 0.15s, color 0.15s'
              }}
            >
              <Heart size={16} fill={isFavorite ? '#f43f5e' : 'none'} color={isFavorite ? '#f43f5e' : 'currentColor'} />
            </button>
          )}
        </div>
      </div>
      <div className="prop-row" style={{ width: '100%', minWidth: 0 }}>
        <span className="prop-label">Artista</span>
        <span className="prop-val" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', width: '100%', minWidth: 0 }} title={song.artist}>
          {song.artist || 'Desconocido'}
        </span>
      </div>
      <div className="prop-row" style={{ width: '100%', minWidth: 0 }}>
        <span className="prop-label">Álbum</span>
        <span className="prop-val" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', width: '100%', minWidth: 0 }} title={song.album}>
          {song.album || 'Desconocido'}
        </span>
      </div>
      <div className="prop-row" style={{ display: 'flex', flexDirection: 'row', gap: '16px', width: '100%', minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span className="prop-label">Año</span>
          <div className="prop-val" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song.year || '—'}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span className="prop-label">Género</span>
          <div className="prop-val" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={song.genre}>
            {song.genre || '—'}
          </div>
        </div>
      </div>

      <div style={{ height: '1px', minHeight: '1px', backgroundColor: 'var(--border-color)', margin: '10px 0', flexShrink: 0, width: '100%' }}></div>

      <div className="prop-row" style={{ width: '100%', minWidth: 0, marginBottom: '8px' }}>
        <span className="prop-label">Info Técnica</span>
        <span className="prop-val" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', minWidth: 0 }}>
          <Info size={13} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {song.codec || 'Audio'} • {song.bitrate || 'Standard'}
          </span>
        </span>
      </div>
      <div className="prop-row" style={{ width: '100%', minWidth: 0, marginBottom: 0 }}>
        <span className="prop-label">Archivo Físico</span>
        <span className="prop-val" style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', width: '100%', minWidth: 0 }} title={song.filename}>
          {song.filename}
        </span>
      </div>
    </>
  );
};

const PipPlayerContent = ({
  activeSong,
  isPlaying,
  currentTime,
  duration,
  progress,
  showSpectrum = true,
  showAlbum = true,
  interactiveProgress = true,
  isFavorite = false,
  onToggleFavorite,
  onTogglePlay,
  onStop,
  onForward,
  onRewind,
  onToggleMute,
  onVolumeChange,
  onNext,
  onPrev,
  onSeek,
  onClose,
  pipLiveBarsRef,
  hotkeys
}) => {
  const rootRef = useRef(null);

  const handleBarClick = (e) => {
    if (!interactiveProgress || !onSeek || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
    onSeek(pct);
  };

  useEffect(() => {
    const win = rootRef.current?.ownerDocument?.defaultView || window;

    const handleKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;

      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const keyName = e.code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
      const keyStr = [...mods, keyName].join('+');

      if (keyStr === (hotkeys?.playPause || 'Space') || e.code === 'Space') {
        e.preventDefault();
        onTogglePlay?.();
      } else if (keyStr === (hotkeys?.stop || 'S')) {
        e.preventDefault();
        onStop?.();
      } else if (keyStr === (hotkeys?.nextTrack || 'Shift+Right')) {
        e.preventDefault();
        onNext?.();
      } else if (keyStr === (hotkeys?.prevTrack || 'Shift+Left')) {
        e.preventDefault();
        onPrev?.();
      } else if (keyStr === (hotkeys?.forward || 'Right') || (!e.shiftKey && !e.ctrlKey && e.code === 'ArrowRight')) {
        e.preventDefault();
        onForward?.();
      } else if (keyStr === (hotkeys?.rewind || 'Left') || (!e.shiftKey && !e.ctrlKey && e.code === 'ArrowLeft')) {
        e.preventDefault();
        onRewind?.();
      } else if (keyStr === (hotkeys?.volUp || 'Up') || (!e.shiftKey && !e.ctrlKey && e.code === 'ArrowUp')) {
        e.preventDefault();
        onVolumeChange?.(-1, 5);
      } else if (keyStr === (hotkeys?.volDown || 'Down') || (!e.shiftKey && !e.ctrlKey && e.code === 'ArrowDown')) {
        e.preventDefault();
        onVolumeChange?.(1, 5);
      } else if (keyStr === (hotkeys?.mute || 'M')) {
        e.preventDefault();
        onToggleMute?.();
      } else if (keyStr === (hotkeys?.favorite || 'L')) {
        e.preventDefault();
        onToggleFavorite?.();
      }
    };

    const handleWheel = (e) => {
      e.preventDefault();
      onVolumeChange?.(e.deltaY, 1);
    };

    win.addEventListener('keydown', handleKeyDown);
    const el = rootRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      win.removeEventListener('keydown', handleKeyDown);
      if (el) {
        el.removeEventListener('wheel', handleWheel);
      }
    };
  }, [hotkeys, onTogglePlay, onStop, onNext, onPrev, onForward, onRewind, onVolumeChange, onToggleMute, onToggleFavorite]);

  return (
    <div className="pip-player-root" ref={rootRef}>
      {/* Contenido Principal (Carátula, Metadatos, Espectro Reactivo y Favorito) */}
      <div className="pip-main-content">
        <div className="pip-cover-box">
          {activeSong?.cover ? (
            <img src={activeSong.cover} alt="Cover" className="pip-cover-img" />
          ) : (
            <Music size={28} style={{ color: 'var(--accent-color, #007acc)', opacity: 0.85 }} />
          )}
        </div>

        <div className="pip-track-details" style={{ position: 'relative', paddingRight: '28px' }}>
          {/* Columna lateral derecha: Espectro arriba + Corazón abajo (o Corazón centrado si no hay espectro) */}
          <div
            className="pip-side-column"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: '24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: showSpectrum ? 'space-between' : 'center',
              padding: '2px 0',
              zIndex: 10
            }}
          >
            {showSpectrum && (
              <div
                className="pip-audio-bars"
                title={isPlaying ? "Espectro reactivo activo" : "En pausa"}
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-end',
                  gap: '2.5px',
                  height: '14px',
                  background: 'none',
                  backgroundColor: 'transparent',
                  border: 'none',
                  boxShadow: 'none',
                  padding: 0,
                  margin: 0
                }}
              >
                <div className="audio-bar" ref={el => { if (pipLiveBarsRef?.current) pipLiveBarsRef.current[0] = el; }}></div>
                <div className="audio-bar" ref={el => { if (pipLiveBarsRef?.current) pipLiveBarsRef.current[1] = el; }}></div>
                <div className="audio-bar" ref={el => { if (pipLiveBarsRef?.current) pipLiveBarsRef.current[2] = el; }}></div>
                <div className="audio-bar" ref={el => { if (pipLiveBarsRef?.current) pipLiveBarsRef.current[3] = el; }}></div>
              </div>
            )}

            <button
              className={`pip-btn-fav ${isFavorite ? 'is-fav' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite?.();
              }}
              title={isFavorite ? "Quitar de favoritos (L)" : "Añadir a favoritos (L)"}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '3px',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isFavorite ? '#f43f5e' : '#94a3b8',
                transition: 'all 0.15s ease',
                lineHeight: 1
              }}
            >
              <Heart size={14} fill={isFavorite ? '#f43f5e' : 'none'} color={isFavorite ? '#f43f5e' : 'currentColor'} />
            </button>
          </div>

          <div className="pip-title" title={activeSong?.title || 'Sin reproducción'}>
            {activeSong?.title || 'Sin reproducción activa'}
          </div>
          <div className="pip-artist" title={activeSong?.artist || 'Desconocido'}>
            {activeSong?.artist || 'Artista Desconocido'}
          </div>
          {showAlbum && (
            <div className="pip-album" title={activeSong?.album || ''}>
              {activeSong?.album || 'Álbum Desconocido'}
            </div>
          )}
        </div>
      </div>

      {/* 3. Fila de Progreso con Acento Dinámico */}
      <div className="pip-progress-row">
        <span className="pip-time-text">{formatTime(currentTime)}</span>
        <div
          className="pip-progress-bar"
          onClick={handleBarClick}
          style={{ cursor: interactiveProgress ? 'pointer' : 'default' }}
          title={interactiveProgress ? "Haz clic para saltar a esta posición" : undefined}
        >
          <div className="pip-progress-fill" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}></div>
        </div>
        <span className="pip-time-text">{formatTime(duration)}</span>
      </div>

      {/* 4. Controles de Reproducción Centrados */}
      <div className="pip-controls-row">
        <div className="pip-playback-controls">
          <button
            className="pip-btn"
            onClick={onPrev}
            title="Pista anterior"
          >
            <SkipBack size={15} />
          </button>

          <button
            className="pip-btn pip-btn-play"
            onClick={onTogglePlay}
            title={isPlaying ? "Pausar" : "Reproducir"}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: '2px' }} />}
          </button>

          <button
            className="pip-btn"
            onClick={onNext}
            title="Siguiente pista"
          >
            <SkipForward size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

function App() {
  const zenCanvasRef = useRef(null);
  const zenCoverRef = useRef(null);
  const zenProgressBarRef = useRef(null);
  const zenScreenBarRef = useRef(null);
  const zenRingRef = useRef(null);
  const zenTimeRef = useRef(null);
  const [activeTab, setActiveTab] = useState('library');
  const [globalIsPlaying, setGlobalIsPlaying] = useState(false);
  const liveBarsRef = useRef([]);
  const pipLiveBarsRef = useRef([]);
  const [isSignatureEggActive, setIsSignatureEggActive] = useState(false);
  const [eggMessage, setEggMessage] = useState('');
  const [logoClicks, setLogoClicks] = useState(0);

  // Fullscreen global state & listener
  const checkFullscreen = () => {
    return Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
      (window.innerHeight >= screen.height - 2 && window.innerWidth >= screen.width - 2)
    );
  };

  const [isFullscreen, setIsFullscreen] = useState(() => checkFullscreen());

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(checkFullscreen());
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      window.removeEventListener('resize', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      const isFull = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFull) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (e) {
      console.warn('Error toggling fullscreen:', e);
    }
  };

  const [hotkeys, setHotkeys] = useState(() => {
    const defaultHotkeys = {
      playPause: 'Space',
      stop: 'S',
      prevTrack: 'Shift+Left',
      nextTrack: 'Shift+Right',
      rewind: 'Left',
      forward: 'Right',
      volDown: 'Down',
      volUp: 'Up',
      mute: 'M',
      random: 'R',
      repeat: 'A',
      favorite: 'L',
      fullscreen: 'F',
      search: 'Ctrl+K',
      clearSearch: 'Escape'
    };
    const saved = localStorage.getItem('musicPlayer_hotkeys');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.volUp === 'ArrowUp') parsed.volUp = 'Up';
        if (parsed.volDown === 'ArrowDown') parsed.volDown = 'Down';
        return { ...defaultHotkeys, ...parsed };
      } catch (e) {
        return defaultHotkeys;
      }
    }
    return defaultHotkeys;
  });
  const [editingHotkey, setEditingHotkey] = useState(null);

  useEffect(() => {
    localStorage.setItem('musicPlayer_hotkeys', JSON.stringify(hotkeys));
  }, [hotkeys]);

  // Zen Mode Customization & GPU High Performance States
  const [zenVisualMode, setZenVisualMode] = useState(() => {
    return localStorage.getItem('musicPlayer_zenVisualMode') || 'bars';
  });
  const [zenBlurIntensity, setZenBlurIntensity] = useState(() => {
    return localStorage.getItem('musicPlayer_zenBlur') || 'deep';
  });
  const [zenVisualOpacity, setZenVisualOpacity] = useState(() => {
    const saved = localStorage.getItem('musicPlayer_zenOpacity');
    return saved !== null ? parseFloat(saved) : 0.6;
  });
  const [zenShowDetails, setZenShowDetails] = useState(() => {
    return localStorage.getItem('musicPlayer_zenShowDetails') !== 'false';
  });
  const [zenCoverPulse, setZenCoverPulse] = useState(() => {
    return localStorage.getItem('musicPlayer_zenCoverPulse') !== 'false';
  });
  const [highPerfGPU, setHighPerfGPU] = useState(() => {
    return localStorage.getItem('musicPlayer_highPerfGPU') !== 'false';
  });

  useEffect(() => {
    localStorage.setItem('musicPlayer_zenVisualMode', zenVisualMode);
  }, [zenVisualMode]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenBlur', zenBlurIntensity);
  }, [zenBlurIntensity]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenOpacity', zenVisualOpacity);
  }, [zenVisualOpacity]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenShowDetails', zenShowDetails);
  }, [zenShowDetails]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenCoverPulse', zenCoverPulse);
  }, [zenCoverPulse]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_highPerfGPU', highPerfGPU);
    if (highPerfGPU) {
      requestHighPerformanceGPU();
    }
  }, [highPerfGPU]);

  // Zen Mode Playback Progress States
  const [zenProgressEnabled, setZenProgressEnabled] = useState(() => {
    return localStorage.getItem('musicPlayer_zenProgressEnabled') !== 'false';
  });
  const [zenProgressMode, setZenProgressMode] = useState(() => {
    const saved = localStorage.getItem('musicPlayer_zenProgressMode');
    return (saved && saved !== 'none') ? saved : 'bar';
  });
  const [zenProgressTiming, setZenProgressTiming] = useState(() => {
    return localStorage.getItem('musicPlayer_zenProgressTiming') || 'both';
  });
  const [zenProgressGlow, setZenProgressGlow] = useState(() => {
    return localStorage.getItem('musicPlayer_zenProgressGlow') !== 'false';
  });

  const [zenCursorVisible, setZenCursorVisible] = useState(true);
  const zenCursorTimerRef = useRef(null);

  // Zen Mode Clock States
  const [zenClockEnabled, setZenClockEnabled] = useState(() => {
    return localStorage.getItem('musicPlayer_zenClockEnabled') !== 'false';
  });
  const [zenClockPosition, setZenClockPosition] = useState(() => {
    return localStorage.getItem('musicPlayer_zenClockPosition') || 'top-right';
  });
  const [zenClockFormat, setZenClockFormat] = useState(() => {
    return localStorage.getItem('musicPlayer_zenClockFormat') || '24h';
  });
  const [zenClockShowSeconds, setZenClockShowSeconds] = useState(() => {
    return localStorage.getItem('musicPlayer_zenClockShowSeconds') === 'true';
  });
  const [zenClockShowDate, setZenClockShowDate] = useState(() => {
    return localStorage.getItem('musicPlayer_zenClockShowDate') !== 'false';
  });
  const [zenClockStyle, setZenClockStyle] = useState(() => {
    return localStorage.getItem('musicPlayer_zenClockStyle') || 'minimal';
  });

  // Modal and Toast States for App Maintenance & Reset
  const [showResetConfigModal, setShowResetConfigModal] = useState(false);
  const [showResetAppModal, setShowResetAppModal] = useState(false);
  const [resetToastMessage, setResetToastMessage] = useState('');

  // 2. Búsqueda instantánea
  const searchInputRef = useRef(null);
  const scanAndProcessDirectoryHandleRef = useRef(null);
  const cachedFileMapRef = useRef(new Map());
  const savedDirHandleRef = useRef(null);
  const [settingsCategory, setSettingsCategory] = useState('appearance');

  // Filtros Rápidos de Biblioteca (Chips de un clic)
  const [libraryFilter, setLibraryFilter] = useState('all'); // 'all' | 'favorites' | 'recent' | 'discoveries'

  // Arrastrar y Soltar inteligente directo a la ventana
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dragTargetZone, setDragTargetZone] = useState('library'); // 'library' | 'queue'
  const dragCounterRef = useRef(0);

  // Mini-Reproductor Flotante "Siempre Visible" (Document Picture-in-Picture)
  const [pipActive, setPipActive] = useState(false);
  const [pipWindow, setPipWindow] = useState(null);
  const [pipProgressData, setPipProgressData] = useState({ currentTime: 0, duration: 0, progress: 0 });

  const [pipEnabled, setPipEnabled] = useState(() => {
    try {
      const s = localStorage.getItem('musicPlayer_pipEnabled');
      return s !== null ? JSON.parse(s) : true;
    } catch (e) {
      return true;
    }
  });
  const [pipSize, setPipSize] = useState(() => localStorage.getItem('musicPlayer_pipSize') || 'standard');
  const [pipShowSpectrum, setPipShowSpectrum] = useState(() => {
    try {
      const s = localStorage.getItem('musicPlayer_pipShowSpectrum');
      return s !== null ? JSON.parse(s) : true;
    } catch (e) {
      return true;
    }
  });
  const [pipShowAlbum, setPipShowAlbum] = useState(() => {
    try {
      const s = localStorage.getItem('musicPlayer_pipShowAlbum');
      return s !== null ? JSON.parse(s) : true;
    } catch (e) {
      return true;
    }
  });
  const [pipInteractiveProgress, setPipInteractiveProgress] = useState(() => {
    try {
      const s = localStorage.getItem('musicPlayer_pipInteractiveProgress');
      return s !== null ? JSON.parse(s) : true;
    } catch (e) {
      return true;
    }
  });
  const [pipAutoOpen, setPipAutoOpen] = useState(() => {
    try {
      const s = localStorage.getItem('musicPlayer_pipAutoOpen');
      return s !== null ? JSON.parse(s) : true;
    } catch (e) {
      return true;
    }
  });
  const [isClonedToOPFS, setIsClonedToOPFS] = useState(() => {
    try {
      return localStorage.getItem('musicPlayer_hasClonedOPFS') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [opfsTrackCount, setOpfsTrackCount] = useState(0);
  const [storageInfo, setStorageInfo] = useState(null);
  const [syncCelebration, setSyncCelebration] = useState(null);
  const celebrationTimerRef = useRef(null);

  const triggerSyncCelebration = (title = 'Sistema Sincronizado', subtitle = 'Almacenamiento permanente autónomo activo') => {
    if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
    setSyncCelebration({ title, subtitle });
    celebrationTimerRef.current = setTimeout(() => {
      setSyncCelebration(null);
    }, 2500);
  };

  // 4. Reconexión rápida de biblioteca (IndexedDB + persistencia instantánea localStorage)
  const [savedFolderInfo, setSavedFolderInfo] = useState(() => {
    try {
      const hasSaved = localStorage.getItem('musicPlayer_hasSavedFolder') === 'true';
      const name = localStorage.getItem('musicPlayer_savedFolderName');
      if (hasSaved && name) {
        return { handle: null, name };
      }
    } catch (e) {}
    return null;
  });
  const [hasDiskPermission, setHasDiskPermission] = useState(false);

  // 4.1. Listas Dinámicas Inteligentes, Favoritos y Reproducciones
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem('musicPlayer_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [playCounts, setPlayCounts] = useState(() => {
    try {
      const saved = localStorage.getItem('musicPlayer_playCounts');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [customSmartPlaylists, setCustomSmartPlaylists] = useState(() => {
    try {
      const saved = localStorage.getItem('musicPlayer_smartPlaylists');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [smartFilterTab, setSmartFilterTab] = useState('all');
  const [editingSmartPlaylist, setEditingSmartPlaylist] = useState(null);
  const [showSmartBuilderModal, setShowSmartBuilderModal] = useState(false);
  const playlistsScrollRef = useRef(null);

  // 4.2. Cola de Reproducción Dinámica («A continuación»)
  const [playQueue, setPlayQueue] = useState([]);

  // 4.3. Menú Contextual personalizado por canción
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    song: null
  });

  // 4.4. Modal de Importación y Respaldo Global
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingImportData, setPendingImportData] = useState(null);

  // 5. Temporizador de Apagado Avanzado (Sleep Timer: Tiempo y Canciones)
  const [sleepTimer, setSleepTimer] = useState({
    active: false,
    mode: 'off', // 'time' | 'tracks' | 'off'
    remainingSeconds: null,
    remainingTracks: null,
    label: ''
  });
  const [sleepSettingsTab, setSleepSettingsTab] = useState('time');
  const [customSettingsHours, setCustomSettingsHours] = useState('');
  const [customSettingsMinutes, setCustomSettingsMinutes] = useState('');
  const [customSettingsTracks, setCustomSettingsTracks] = useState('');

  // Acción al finalizar el temporizador ('clock' | 'black' | 'none')
  const [sleepTimerEndAction, setSleepTimerEndAction] = useState(() => {
    return localStorage.getItem('musicPlayer_sleepTimerEndAction') || 'clock';
  });
  const [isSleepStandbyActive, setIsSleepStandbyActive] = useState(false);

  useEffect(() => {
    localStorage.setItem('musicPlayer_sleepTimerEndAction', sleepTimerEndAction);
  }, [sleepTimerEndAction]);

  // Duración del desvanecimiento suave (fade-out) del temporizador en segundos
  const [sleepTimerFadeSeconds, setSleepTimerFadeSeconds] = useState(() => {
    const saved = localStorage.getItem('musicPlayer_sleepTimerFadeSeconds');
    return saved !== null ? (parseInt(saved, 10) || 0) : 5;
  });

  useEffect(() => {
    localStorage.setItem('musicPlayer_sleepTimerFadeSeconds', String(sleepTimerFadeSeconds));
  }, [sleepTimerFadeSeconds]);

  useEffect(() => {
    const handleSleepTimerFinished = () => {
      if (sleepTimerEndAction !== 'none') {
        setIsSleepStandbyActive(true);
        if (pipWindow) {
          try { pipWindow.close(); } catch (e) {}
        }
      }
    };
    window.addEventListener('musicPlayer_sleepTimerFinished', handleSleepTimerFinished);
    return () => window.removeEventListener('musicPlayer_sleepTimerFinished', handleSleepTimerFinished);
  }, [sleepTimerEndAction, pipWindow]);

  useEffect(() => {
    if (!isSleepStandbyActive) return;
    const handleWake = () => setIsSleepStandbyActive(false);
    window.addEventListener('keydown', handleWake);
    window.addEventListener('mousedown', handleWake);
    window.addEventListener('touchstart', handleWake);
    return () => {
      window.removeEventListener('keydown', handleWake);
      window.removeEventListener('mousedown', handleWake);
      window.removeEventListener('touchstart', handleWake);
    };
  }, [isSleepStandbyActive]);

  const activateSleepTimerByTime = (seconds, customLabel = '') => {
    const secs = Math.max(1, parseInt(seconds, 10) || 60);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    const timeText = hrs > 0 ? (remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs} hora${hrs > 1 ? 's' : ''}`) : `${mins} minutos`;
    const label = customLabel || (hrs > 0 ? `${hrs}h` : `${mins}m`);

    setSleepTimer({
      active: true,
      mode: 'time',
      remainingSeconds: secs,
      remainingTracks: null,
      label
    });

    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `Temporizador activo: Se apagará en ${timeText}.` }
    }));
  };

  const activateSleepTimerByTracks = (tracks) => {
    const numTracks = Math.max(1, parseInt(tracks, 10) || 1);
    setSleepTimer({
      active: true,
      mode: 'tracks',
      remainingSeconds: null,
      remainingTracks: numTracks,
      label: numTracks === 1 ? 'Fin de canción actual' : `${numTracks} canciones`
    });

    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: {
        message: numTracks === 1
          ? 'Temporizador activo: Se apagará al terminar la pista actual.'
          : `Temporizador activo: Se apagará tras reproducir ${numTracks} canciones.`
      }
    }));
  };

  const cancelSleepTimer = () => {
    setSleepTimer({
      active: false,
      mode: 'off',
      remainingSeconds: null,
      remainingTracks: null,
      label: ''
    });
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: 'Temporizador de apagado cancelado.' }
    }));
  };

  // Temporizador de Apagado: Countdown centralizado e infalible
  useEffect(() => {
    if (!sleepTimer.active || sleepTimer.mode !== 'time' || sleepTimer.remainingSeconds === null) return;

    if (sleepTimer.remainingSeconds <= 0) {
      // 1. Pausar la reproducción del audio
      window.dispatchEvent(new CustomEvent('musicPlayer_requestPausePlayback'));
      // 2. Disparar evento de finalización para modo Standby nocturno
      window.dispatchEvent(new CustomEvent('musicPlayer_sleepTimerFinished'));
      // 3. Notificar al usuario con toast
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Temporizador completado: La música se ha apagado. ¡Buenas noches!' }
      }));
      // 4. Limpiar estado del temporizador
      setSleepTimer({
        active: false,
        mode: 'off',
        remainingSeconds: null,
        remainingTracks: null,
        label: ''
      });
      return;
    }

    const intervalId = setInterval(() => {
      setSleepTimer(prev => {
        if (!prev.active || prev.mode !== 'time' || prev.remainingSeconds === null) return prev;
        return { ...prev, remainingSeconds: Math.max(0, prev.remainingSeconds - 1) };
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [sleepTimer.active, sleepTimer.mode, sleepTimer.remainingSeconds === 0]);

  const tickSleepTimerSeconds = () => {};

  const decrementSleepTimerTracks = () => {
    setSleepTimer(prev => {
      if (!prev.active || prev.mode !== 'tracks' || prev.remainingTracks === null) return prev;
      const nextTracks = prev.remainingTracks - 1;
      if (nextTracks <= 0) {
        return { ...prev, active: false, mode: 'off', remainingTracks: 0 };
      }
      return { ...prev, remainingTracks: nextTracks };
    });
  };

  // Notificaciones Toast Globales (Manejo de Errores de Decodificación y Eventos)
  const [toastData, setToastData] = useState(null);
  const [isToastExiting, setIsToastExiting] = useState(false);

  // 6. Instalabilidad como PWA de Escritorio
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalledPWA, setIsInstalledPWA] = useState(() => {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  });


  // Escuchar Toasts Globales con animación suave de desvanecimiento
  useEffect(() => {
    let toastTimer = null;
    let exitTimer = null;

    const handleAppToast = (e) => {
      if (toastTimer) clearTimeout(toastTimer);
      if (exitTimer) clearTimeout(exitTimer);

      const { message, isError = false, icon = null, duration = 3500 } = e.detail || {};
      setIsToastExiting(false);
      setToastData({ message, isError, icon });

      toastTimer = setTimeout(() => {
        setIsToastExiting(true);
        exitTimer = setTimeout(() => {
          setToastData(null);
          setIsToastExiting(false);
        }, 220); // 220ms de duración para toastFadeOut en CSS
      }, duration);
    };

    window.addEventListener('musicPlayer_appToast', handleAppToast);
    return () => {
      window.removeEventListener('musicPlayer_appToast', handleAppToast);
      if (toastTimer) clearTimeout(toastTimer);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, []);

  // Eventos de PWA para instalación de escritorio
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleAppInstalled = () => {
      setIsInstalledPWA(true);
      setDeferredPrompt(null);
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: '¡Aplicación instalada con éxito en tu sistema!' }
      }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Atajo Global de Búsqueda Instantánea configurable
  useEffect(() => {
    const handleSearchShortcut = (e) => {
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (isInput) return;

      const mods = [];
      if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const keyName = e.code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
      const keyStr = [...mods, keyName].join('+');

      const targetSearchHotkey = hotkeys.search || 'Ctrl+K';

      if (keyStr === targetSearchHotkey) {
        e.preventDefault();
        setIsIdle(false);
        setActiveTab('library');
        setTimeout(() => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
            searchInputRef.current.select();
          }
        }, 40);
      }
    };

    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [hotkeys.search]);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalledPWA(true);
    }
    setDeferredPrompt(null);
  };

  useEffect(() => {
    localStorage.setItem('musicPlayer_zenProgressEnabled', zenProgressEnabled);
  }, [zenProgressEnabled]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenProgressMode', zenProgressMode);
  }, [zenProgressMode]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenProgressTiming', zenProgressTiming);
  }, [zenProgressTiming]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenProgressGlow', zenProgressGlow);
  }, [zenProgressGlow]);

  useEffect(() => {
    localStorage.setItem('musicPlayer_zenClockEnabled', zenClockEnabled);
  }, [zenClockEnabled]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenClockPosition', zenClockPosition);
  }, [zenClockPosition]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenClockFormat', zenClockFormat);
  }, [zenClockFormat]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenClockShowSeconds', zenClockShowSeconds);
  }, [zenClockShowSeconds]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenClockShowDate', zenClockShowDate);
  }, [zenClockShowDate]);
  useEffect(() => {
    localStorage.setItem('musicPlayer_zenClockStyle', zenClockStyle);
  }, [zenClockStyle]);

  const handleResetPreferences = () => {
    const defaultHotkeys = {
      playPause: 'Space',
      stop: 'S',
      prevTrack: 'Shift+Left',
      nextTrack: 'Shift+Right',
      rewind: 'Left',
      forward: 'Right',
      volDown: 'Down',
      volUp: 'Up',
      mute: 'M',
      random: 'R',
      repeat: 'A',
      fullscreen: 'F',
      search: 'Ctrl+K',
      clearSearch: 'Escape'
    };

    const configKeys = [
      'musicPlayer_accentColor',
      'musicPlayer_smoothFade',
      'musicPlayer_idleMode',
      'musicPlayer_idleTimeout',
      'musicPlayer_zenVisualMode',
      'musicPlayer_zenBlur',
      'musicPlayer_zenOpacity',
      'musicPlayer_zenShowDetails',
      'musicPlayer_zenCoverPulse',
      'musicPlayer_highPerfGPU',
      'musicPlayer_largeSpectrum',
      'musicPlayer_largeSpectrumHeight',
      'musicPlayer_easterEggs',
      'musicPlayer_hotkeys',
      'musicPlayer_zenProgressEnabled',
      'musicPlayer_zenProgressMode',
      'musicPlayer_zenProgressTiming',
      'musicPlayer_zenProgressGlow',
      'musicPlayer_zenClockEnabled',
      'musicPlayer_zenClockPosition',
      'musicPlayer_zenClockFormat',
      'musicPlayer_zenClockShowSeconds',
      'musicPlayer_zenClockShowDate',
      'musicPlayer_zenClockStyle',
      'musicPlayer_volume',
      'musicPlayer_repeat',
      'musicPlayer_random',
      'musicPlayer_customAccentColors',
      'musicPlayer_sleepTimerEndAction',
      'musicPlayer_sleepTimerFadeSeconds'
    ];
    configKeys.forEach(k => localStorage.removeItem(k));

    setAccentColor('#007acc');
    setCustomAccentColors([]);
    setSleepTimerEndAction('clock');
    setSleepTimerFadeSeconds(5);
    setSmoothFade(true);
    setIdleModeEnabled(true);
    setIdleTimeoutSeconds(15);
    setZenVisualMode('bars');
    setZenBlurIntensity('deep');
    setZenVisualOpacity(0.6);
    setZenShowDetails(true);
    setZenCoverPulse(true);
    setHighPerfGPU(true);
    setLargeSpectrumEnabled(true);
    setLargeSpectrumHeight('mediano');
    setEasterEggsEnabled(false);
    setHotkeys(defaultHotkeys);
    setZenProgressEnabled(true);
    setZenProgressMode('bar');
    setZenProgressTiming('both');
    setZenProgressGlow(true);
    setZenClockEnabled(true);
    setZenClockPosition('top-right');
    setZenClockFormat('24h');
    setZenClockShowSeconds(false);
    setZenClockShowDate(true);
    setZenClockStyle('minimal');

    setShowResetConfigModal(false);
    setResetToastMessage('Se han restablecido todas las preferencias al estado por defecto.');
    setTimeout(() => setResetToastMessage(''), 4000);
  };

  const handleResetFullApp = async () => {
    try {
      window.dispatchEvent(new CustomEvent('musicPlayer_stop'));
      closePiP();
      await clearSavedDirectoryHandle();
      await clearOPFSTracks();
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      songs.forEach(s => {
        if (s.url) URL.revokeObjectURL(s.url);
        if (s.cover) URL.revokeObjectURL(s.cover);
      });

      localStorage.clear();
      sessionStorage.clear();

      if (window.indexedDB && indexedDB.databases) {
        try {
          const dbs = await indexedDB.databases();
          dbs.forEach(db => {
            if (db.name) indexedDB.deleteDatabase(db.name);
          });
        } catch (e) {
          console.warn('Error clearing IndexedDB:', e);
        }
      }

      if (window.caches) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        } catch (e) {
          console.warn('Error clearing caches:', e);
        }
      }

      window.location.href = window.location.origin + window.location.pathname;
    } catch (err) {
      console.error('Error in handleResetFullApp:', err);
      window.location.reload();
    }
  };

  const [easterEggsEnabled, setEasterEggsEnabled] = useState(() => {
    return localStorage.getItem('musicPlayer_easterEggs') === 'true';
  });
  const [smoothFade, setSmoothFade] = useState(() => {
    return localStorage.getItem('musicPlayer_smoothFade') !== 'false';
  });
  const [largeSpectrumEnabled, setLargeSpectrumEnabled] = useState(() => {
    return localStorage.getItem('musicPlayer_largeSpectrum') !== 'false';
  });
  const [largeSpectrumHeight, setLargeSpectrumHeight] = useState(() => {
    return localStorage.getItem('musicPlayer_largeSpectrumHeight') || 'mediano';
  });

  const [accentColor, setAccentColor] = useState(() => {
    return localStorage.getItem('musicPlayer_accentColor') || '#007acc';
  });

  const largeCanvasRef = useRef(null);
  const prevSpectrumRef = useRef(new Float32Array(256));

  useEffect(() => {
    const resize = () => {
      if (largeCanvasRef.current) {
        largeCanvasRef.current.width = largeCanvasRef.current.clientWidth;
        largeCanvasRef.current.height = largeCanvasRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();
    setTimeout(resize, 100);
    return () => window.removeEventListener('resize', resize);
  }, [activeTab, largeSpectrumEnabled, largeSpectrumHeight]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-color', accentColor);
    localStorage.setItem('musicPlayer_accentColor', accentColor);
  }, [accentColor]);

  // Colores de acento personalizados por el usuario
  const [customAccentColors, setCustomAccentColors] = useState(() => {
    try {
      const saved = localStorage.getItem('musicPlayer_customAccentColors');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('musicPlayer_customAccentColors', JSON.stringify(customAccentColors));
    } catch (e) {}
  }, [customAccentColors]);

  const [manualColorHex, setManualColorHex] = useState('#6366f1');
  const [manualColorName, setManualColorName] = useState('');

  const handleSaveCustomColor = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    let hex = (manualColorHex || '').trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Por favor introduce un código hexadecimal válido (ej. #6366f1 o #38bdf8).' }
      }));
      return;
    }
    if (hex.length === 4) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    hex = hex.toLowerCase();

    const name = (manualColorName || '').trim() || `Color ${hex.toUpperCase()}`;
    const newColorObj = {
      id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      name,
      hex,
      createdAt: Date.now()
    };

    setCustomAccentColors(prev => {
      const filtered = prev.filter(c => c.hex.toLowerCase() !== hex);
      return [newColorObj, ...filtered];
    });

    setAccentColor(hex);
    setManualColorName('');
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `¡Color "${name}" (${hex}) guardado y aplicado con éxito!` }
    }));
  };

  const handleDeleteCustomColor = (colorId, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setCustomAccentColors(prev => prev.filter(c => c.id !== colorId));
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: 'Color personalizado eliminado.' }
    }));
  };

  const handlePickScreenColor = async () => {
    if (typeof window !== 'undefined' && window.EyeDropper) {
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        if (result && result.sRGBHex) {
          setManualColorHex(result.sRGBHex.toLowerCase());
        }
      } catch (e) {
        // Cancelado por el usuario
      }
    }
  };

  useEffect(() => {
    localStorage.setItem('musicPlayer_easterEggs', easterEggsEnabled);
  }, [easterEggsEnabled]);

  useEffect(() => {
    localStorage.setItem('musicPlayer_smoothFade', smoothFade);
  }, [smoothFade]);

  useEffect(() => {
    localStorage.setItem('musicPlayer_largeSpectrum', largeSpectrumEnabled);
  }, [largeSpectrumEnabled]);

  useEffect(() => {
    localStorage.setItem('musicPlayer_largeSpectrumHeight', largeSpectrumHeight);
  }, [largeSpectrumHeight]);

  const [idleModeEnabled, setIdleModeEnabled] = useState(() => {
    return localStorage.getItem('musicPlayer_idleMode') !== 'false';
  });
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(() => {
    const saved = localStorage.getItem('musicPlayer_idleTimeout');
    return saved ? parseInt(saved, 10) : 15;
  });
  const [isIdle, setIsIdle] = useState(false);

  useEffect(() => {
    localStorage.setItem('musicPlayer_idleMode', idleModeEnabled);
  }, [idleModeEnabled]);

  useEffect(() => {
    localStorage.setItem('musicPlayer_idleTimeout', idleTimeoutSeconds);
  }, [idleTimeoutSeconds]);

  const handleToggleIdleMode = useCallback(() => {
    setIdleModeEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem('musicPlayer_idleMode', next);
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: {
          message: next ? 'Modo Zen automático activado' : 'Modo Zen automático desactivado',
          icon: 'zen'
        }
      }));
      return next;
    });
  }, []);

  const handleTogglePipAutoOpen = useCallback(() => {
    setPipAutoOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem('musicPlayer_pipAutoOpen', JSON.stringify(next));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: {
          message: next
            ? 'Mini-reproductor automático activado'
            : 'Mini-reproductor automático desactivado',
          icon: 'pip'
        }
      }));
      return next;
    });
  }, []);

  const isIdleRef = useRef(false);
  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  // Idle Timer Logic con soporte para navegación y hotkeys en Modo Zen
  useEffect(() => {
    let timeoutId = null;

    const startCountdown = () => {
      clearTimeout(timeoutId);
      if (idleModeEnabled) {
        timeoutId = setTimeout(() => {
          setIsIdle(true);
        }, idleTimeoutSeconds * 1000);
      }
    };

    const handleMouseMove = () => {
      // En modo Zen: mover el mouse NO sale del modo zen
      if (!isIdleRef.current) {
        startCountdown();
      }
    };

    const handleClick = () => {
      // Al hacer clic en cualquier parte de la pantalla, si está en modo Zen, sale del modo zen
      if (isIdleRef.current) {
        setIsIdle(false);
      }
      startCountdown();
    };

    const handleScroll = () => {
      if (!isIdleRef.current) {
        startCountdown();
      }
    };

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        startCountdown();
        return;
      }

      // Si la tecla presionada es únicamente una tecla modificadora (Shift, Ctrl, Alt, Meta), ignorarla
      // para permitir combinaciones compuestas (ej: Shift+Right para siguiente pista) sin romper el Modo Zen
      if (
        ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) ||
        ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)
      ) {
        return;
      }

      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const keyName = e.code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
      const keyStr = [...mods, keyName].join('+');

      const isPlaybackKey = [
        hotkeys.playPause,
        hotkeys.stop,
        hotkeys.nextTrack,
        hotkeys.prevTrack,
        hotkeys.forward,
        hotkeys.rewind,
        hotkeys.volDown,
        hotkeys.volUp,
        hotkeys.mute,
        hotkeys.favorite || 'L',
        hotkeys.fullscreen,
        hotkeys.random,
        hotkeys.repeat
      ].includes(keyStr) || keyStr === 'F11' || e.key === 'F11' || e.code === 'F11';

      if (keyStr === (hotkeys.favorite || 'L')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('musicPlayer_toggleCurrentFavorite'));
      }

      if (isIdleRef.current) {
        if (!isPlaybackKey) {
          // Si presiona cualquier tecla que NO sea una hotkey de reproducción, sale del modo Zen
          setIsIdle(false);
          startCountdown();
        }
        // Si ES una hotkey, NO salimos del modo zen y dejamos que CustomPlayer ejecute la acción
      } else {
        startCountdown();
      }
    };

    if (idleModeEnabled) {
      startCountdown();
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('click', handleClick);
      window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
      window.addEventListener('wheel', handleScroll, { capture: true, passive: true });
      window.addEventListener('touchmove', handleScroll, { capture: true, passive: true });
      window.addEventListener('keydown', handleKeyDown);
    } else {
      setIsIdle(false);
    }

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('wheel', handleScroll, { capture: true });
      window.removeEventListener('touchmove', handleScroll, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [idleModeEnabled, idleTimeoutSeconds, hotkeys]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [songs, setSongs] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'asc' });

  // Vinculación rápida de archivos desde DirectoryHandle sin re-parsear metadatos
  const linkFilesFromDirectoryHandle = async (handle) => {
    if (!handle) return false;
    try {
      const fileMap = new Map();
      const walk = async (h, prefix = '') => {
        for await (const entry of h.values()) {
          if (entry.kind === 'file' && entry.name.match(/\.(mp3|flac|m4a|wav|ogg)$/i)) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            fileMap.set(rel.toLowerCase(), entry);
            fileMap.set(entry.name.toLowerCase(), entry);
          } else if (entry.kind === 'directory') {
            const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
            await walk(entry, subPrefix);
          }
        }
      };
      await walk(handle);
      cachedFileMapRef.current = fileMap;

      setSongs(prevSongs => {
        let changed = false;
        const updated = prevSongs.map(song => {
          if (song.fileEntry && song.rawFile) return song;
          const keyPath = (song.path || '').toLowerCase();
          const keyName = (song.filename || '').toLowerCase();
          const entry = fileMap.get(keyPath) || fileMap.get(keyName);
          if (entry && song.fileEntry !== entry) {
            changed = true;
            return { ...song, fileEntry: entry };
          }
          return song;
        });
        return changed ? updated : prevSongs;
      });

      setHasDiskPermission(true);
      return true;
    } catch (walkErr) {
      console.warn('Error vinculando archivos del handle:', walkErr);
      return false;
    }
  };

  // Carga instantánea de catálogo desde IndexedDB (0 ms) + verificación de permisos en segundo plano
  useEffect(() => {
    let isCancelled = false;

    const initLibrary = async () => {
      // 1. Cargar biblioteca desde la caché de metadatos de IndexedDB (0 ms)
      try {
        const cached = await getCachedLibrary();
        if (cached && Array.isArray(cached.songs) && cached.songs.length > 0 && !isCancelled) {
          setSongs(cached.songs);
        }
      } catch (cacheErr) {
        console.warn('Error leyendo caché inicial de metadatos:', cacheErr);
      }

      // 2. Comprobar pistas en almacenamiento permanente autónomo (OPFS - Cero permisos requeridos)
      try {
        if (isOPFSSupported()) {
          const opfsFiles = await listOPFSTracks();
          if (opfsFiles && opfsFiles.length > 0 && !isCancelled) {
            setIsClonedToOPFS(true);
            setOpfsTrackCount(opfsFiles.length);
            setHasDiskPermission(true); // ¡Pistas disponibles inmediatamente sin permisos ni diálogos!
          }
          const estimate = await getStorageEstimate();
          if (estimate && !isCancelled) {
            setStorageInfo(estimate);
          }
        }
      } catch (opfsErr) {
        console.warn('Error comprobando almacenamiento OPFS en inicio:', opfsErr);
      }

      // 3. Recuperar handle guardado de la carpeta externa
      try {
        const saved = await getSavedDirectoryHandle();
        if (saved && saved.handle && !isCancelled) {
          savedDirHandleRef.current = saved.handle;
          setSavedFolderInfo({
            handle: saved.handle,
            name: saved.name || saved.handle.name || 'Carpeta de música'
          });

          // 4. Comprobar permisos si el navegador lo soporta
          if (saved.handle.queryPermission) {
            try {
              const status = await saved.handle.queryPermission({ mode: 'read' });
              if (status === 'granted' && !isCancelled) {
                setHasDiskPermission(true);
                // Vinculación en segundo plano de File objects (~20 ms)
                await linkFilesFromDirectoryHandle(saved.handle);
              }
            } catch (permErr) {
              console.warn('Error comprobando permiso de directorio guardado:', permErr);
            }
          }
        }
      } catch (err) {
        console.warn('Error al leer handle de IndexedDB:', err);
      }
    };

    initLibrary();
    return () => { isCancelled = true; };
  }, []);

  const [exploreView, setExploreView] = useState('home'); // 'home', 'artists', 'albums', 'genres', 'years'
  const exploreScrollRef = useRef(null);
  const [rouletteSpinning, setRouletteSpinning] = useState(false);
  const [rouletteResult, setRouletteResult] = useState(null);

  const exploreData = useMemo(() => {
    if (!songs.length) return null;

    const covers = songs.filter(s => s.cover).map(s => s.cover);
    const shuffledCovers = [...covers].sort(() => 0.5 - Math.random());

    const cardCovers = {
      artists: shuffledCovers.slice(0, 4),
      albums: shuffledCovers.slice(4, 8),
      genres: shuffledCovers.slice(8, 12),
      years: shuffledCovers.slice(12, 16)
    };

    const albumsMap = {};
    songs.forEach(s => {
      if (s.album && s.album !== 'Desconocido') {
        albumsMap[s.album] = (albumsMap[s.album] || []);
        albumsMap[s.album].push(s);
      }
    });
    const albumsList = Object.entries(albumsMap);
    const randomAlbum = albumsList.length ? albumsList[Math.floor(Math.random() * albumsList.length)] : null;

    const randomTracks = [...songs].sort(() => 0.5 - Math.random()).slice(0, 5);

    return { cardCovers, randomAlbum, randomTracks };
  }, [songs]);

  const [selectedSong, setSelectedSong] = useState(null);
  const [activeSong, setActiveSong] = useState(null);
  const [prevSong, setPrevSong] = useState(null);
  const [isCrossfading, setIsCrossfading] = useState(false);

  useEffect(() => {
    if (selectedSong !== activeSong) {
      if (activeSong) {
        setPrevSong(activeSong);
        setIsCrossfading(true);
      }
      setActiveSong(selectedSong);

      const timer = setTimeout(() => {
        setIsCrossfading(false);
        setPrevSong(null);
      }, 300);

      // We do NOT return clearTimeout here, otherwise setting activeSong 
      // will trigger a re-render, run cleanup, and cancel this timer forever.
      // Since selectedSong is stable, this is safe.
    }
  }, [selectedSong]); // Only depend on selectedSong to avoid cleanup loops

  // Control pasivo de volumen con la rueda del ratón (Scroll) exclusivo en Modo Zen
  useEffect(() => {
    if (!isIdle || !activeSong) return;

    const handleZenWheel = (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('musicPlayer_wheelVolume', { detail: { deltaY: e.deltaY } }));
    };

    window.addEventListener('wheel', handleZenWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleZenWheel);
  }, [isIdle, activeSong]);

  const [highlightedSong, setHighlightedSong] = useState(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState(null);

  const [baseList, setBaseList] = useState(null);
  const [playlistTitle, setPlaylistTitle] = useState('Biblioteca General');

  const [modalData, setModalData] = useState(null);

  const [randomHistory, setRandomHistory] = useState([]);
  const [randomHistoryIndex, setRandomHistoryIndex] = useState(-1);

  const fileInputRef = useRef(null);
  const tableContainerRef = useRef(null);
  const dashboardScrollRef = useRef(null);
  const settingsScrollRef = useRef(null);
  const hasSongs = songs.length > 0;

  useSmoothScroll(tableContainerRef, hasSongs && activeTab === 'library');
  useSmoothScroll(dashboardScrollRef, hasSongs && activeTab === 'dashboard');
  useSmoothScroll(settingsScrollRef, activeTab === 'settings');
  useSmoothScroll(exploreScrollRef, hasSongs && activeTab === 'explore');
  useSmoothScroll(playlistsScrollRef, hasSongs && activeTab === 'playlists');

  useEffect(() => {
    document.title = 'Reproductor de música';
  }, []);

  // Mini-Reproductor Flotante Inteligente (Document Picture-in-Picture con soporte estilo WhatsApp Web)
  const pipActiveRef = useRef(pipActive);
  pipActiveRef.current = pipActive;
  const pipWindowRef = useRef(pipWindow);
  pipWindowRef.current = pipWindow;
  const activeSongRef = useRef(activeSong);
  activeSongRef.current = activeSong;
  const globalIsPlayingRef = useRef(globalIsPlaying);
  globalIsPlayingRef.current = globalIsPlaying;
  const pipEnabledRef = useRef(pipEnabled);
  pipEnabledRef.current = pipEnabled;
  const pipAutoOpenRef = useRef(pipAutoOpen);
  pipAutoOpenRef.current = pipAutoOpen;
  const pipSizeRef = useRef(pipSize);
  pipSizeRef.current = pipSize;
  const accentColorRef = useRef(accentColor);
  accentColorRef.current = accentColor;
  const isAutoPiPRef = useRef(false);
  const userClosedManuallyRef = useRef(false);
  const wasHiddenRef = useRef(typeof document !== 'undefined' ? document.hidden : false);

  const closePiP = useCallback(() => {
    const win = pipWindowRef.current;
    if (win) {
      try {
        if (!win.closed) win.close();
      } catch (e) {}
    }
    pipWindowRef.current = null;
    pipActiveRef.current = false;
    setPipActive(false);
    setPipWindow(null);
    isAutoPiPRef.current = false;
  }, []);

  const openPiP = useCallback(async (isAuto = false) => {
    if (pipActiveRef.current && pipWindowRef.current && !pipWindowRef.current.closed) {
      return;
    }

    if (!pipEnabledRef.current) {
      if (!isAuto) setStatusMessage('El mini-reproductor está desactivado en la configuración.');
      return;
    }

    if (!activeSongRef.current) return;

    isAutoPiPRef.current = isAuto;
    userClosedManuallyRef.current = false;

    const sizes = {
      compact: { width: 330, height: 150 },
      standard: { width: 380, height: 185 },
      expanded: { width: 440, height: 220 }
    };
    const { width, height } = sizes[pipSizeRef.current] || sizes.standard;

    try {
      if ('documentPictureInPicture' in window) {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width,
          height,
          disallowReturnToOpener: false
        });

        Array.from(document.styleSheets).forEach((sheet) => {
          try {
            const cssRules = Array.from(sheet.cssRules).map(rule => rule.cssText).join('');
            const style = pipWin.document.createElement('style');
            style.textContent = cssRules;
            pipWin.document.head.appendChild(style);
          } catch (e) {
            const link = pipWin.document.createElement('link');
            link.rel = 'stylesheet';
            link.type = sheet.type;
            link.media = sheet.media;
            link.href = sheet.href;
            pipWin.document.head.appendChild(link);
          }
        });

        const accent = document.documentElement.style.getPropertyValue('--accent-color') || accentColorRef.current;
        if (accent) {
          pipWin.document.documentElement.style.setProperty('--accent-color', accent);
        }
        pipWin.document.body.style.margin = '0';
        pipWin.document.body.style.padding = '0';
        pipWin.document.body.style.overflow = 'hidden';
        const curSong = activeSongRef.current;
        const appTitle = curSong ? `${curSong.title} • Reproductor de música` : 'Reproductor de música';
        pipWin.document.title = appTitle;
        try {
          const titleTag = pipWin.document.createElement('title');
          titleTag.textContent = appTitle;
          pipWin.document.head.appendChild(titleTag);
        } catch (e) {}

        pipWin.addEventListener('pagehide', () => {
          pipActiveRef.current = false;
          pipWindowRef.current = null;
          setPipActive(false);
          setPipWindow(null);
          if (document.hidden) {
            userClosedManuallyRef.current = true;
          }
        });

        pipWindowRef.current = pipWin;
        pipActiveRef.current = true;
        setPipWindow(pipWin);
        setPipActive(true);
      } else {
        const left = window.screen.width - width - 40;
        const top = window.screen.height - height - 80;
        const popup = window.open('', 'musicPlayer_pip', `width=${width},height=${height},left=${left},top=${top},resizable=yes`);
        if (popup) {
          Array.from(document.styleSheets).forEach((sheet) => {
            try {
              const cssRules = Array.from(sheet.cssRules).map(rule => rule.cssText).join('');
              const style = popup.document.createElement('style');
              style.textContent = cssRules;
              popup.document.head.appendChild(style);
            } catch (e) {
              const link = popup.document.createElement('link');
              link.rel = 'stylesheet';
              link.href = sheet.href;
              popup.document.head.appendChild(link);
            }
          });
          const accent = document.documentElement.style.getPropertyValue('--accent-color') || accentColorRef.current;
          if (accent) {
            popup.document.documentElement.style.setProperty('--accent-color', accent);
          }
          popup.document.body.style.margin = '0';
          popup.document.body.style.padding = '0';
          popup.document.body.style.overflow = 'hidden';
          const curSong = activeSongRef.current;
          const popupTitle = curSong ? `${curSong.title} • Reproductor de música` : 'Reproductor de música';
          popup.document.title = popupTitle;
          try {
            const titleTag = popup.document.createElement('title');
            titleTag.textContent = popupTitle;
            popup.document.head.appendChild(titleTag);
          } catch (e) {}
          popup.addEventListener('beforeunload', () => {
            pipActiveRef.current = false;
            pipWindowRef.current = null;
            setPipActive(false);
            setPipWindow(null);
            if (document.hidden) {
              userClosedManuallyRef.current = true;
            }
          });
          pipWindowRef.current = popup;
          pipActiveRef.current = true;
          setPipWindow(popup);
          setPipActive(true);
        }
      }
    } catch (err) {
      console.error('Error abriendo Document Picture-in-Picture:', err);
      if (!isAuto) {
        setStatusMessage('No se pudo abrir la ventana flotante.');
      }
    }
  }, []);

  const togglePiP = useCallback(async () => {
    if (pipActiveRef.current && pipWindowRef.current && !pipWindowRef.current.closed) {
      closePiP();
    } else {
      await openPiP(false);
    }
  }, [closePiP, openPiP]);

  useEffect(() => {
    if (pipWindow && !pipWindow.closed) {
      try {
        const titleText = activeSong
          ? `${activeSong.title} • Reproductor de música`
          : 'Reproductor de música';
        pipWindow.document.title = titleText;
        const titleEl = pipWindow.document.querySelector('title');
        if (titleEl) titleEl.textContent = titleText;
        pipWindow.document.documentElement.style.setProperty('--accent-color', accentColor);
      } catch (e) {}
    }
  }, [pipWindow, activeSong, globalIsPlaying, accentColor]);

  // Soporte oficial para Auto Picture-in-Picture vía MediaSession (estándar nativo de navegadores modernos)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setActionHandler) return;

    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
        if (!pipAutoOpenRef.current || !pipEnabledRef.current) return;
        if (!activeSongRef.current || !globalIsPlayingRef.current) return;
        if (pipActiveRef.current && pipWindowRef.current && !pipWindowRef.current.closed) return;
        if (userClosedManuallyRef.current) return;

        await openPiP(true);
      });
    } catch (e) {
      console.warn('MediaSession enterpictureinpicture action handler not supported:', e);
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
      } catch (e) {}
    };
  }, [openPiP]);

  // Reconocimiento inteligente de salida y entrada a pantalla ("en plano", estilo WhatsApp Web)
  useEffect(() => {
    let debounceTimer = null;

    const handleVisibilityOrFocus = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const isHidden = document.hidden;

        if (isHidden) {
          // Ventana/pestaña sale de plano (cambio de pestaña, minimizada o segundo plano)
          wasHiddenRef.current = true;

          if (
            pipAutoOpenRef.current &&
            pipEnabledRef.current &&
            activeSongRef.current &&
            globalIsPlayingRef.current &&
            !userClosedManuallyRef.current &&
            (!pipActiveRef.current || !pipWindowRef.current || pipWindowRef.current.closed)
          ) {
            try {
              await openPiP(true);
            } catch (err) {}
          }
        } else {
          // Ventana/pestaña vuelve a primer plano ("en plano")
          wasHiddenRef.current = false;
          userClosedManuallyRef.current = false;

          // Si el mini-reproductor está abierto y el usuario regresa a la ventana principal,
          // se cierra automáticamente de forma limpia e intuitiva exactamente como en WhatsApp Web
          if (
            pipAutoOpenRef.current &&
            (pipActiveRef.current || (pipWindowRef.current && !pipWindowRef.current.closed))
          ) {
            closePiP();
          }
        }
      }, 60);
    };

    const handleWindowFocus = () => {
      if (document.visibilityState === 'visible') {
        if (
          pipAutoOpenRef.current &&
          wasHiddenRef.current &&
          (pipActiveRef.current || (pipWindowRef.current && !pipWindowRef.current.closed))
        ) {
          wasHiddenRef.current = false;
          userClosedManuallyRef.current = false;
          closePiP();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      clearTimeout(debounceTimer);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [openPiP, closePiP]);

  useEffect(() => {
    const handleDragEnter = (e) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsDraggingOver(true);
      }
    };

    const handleDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
      }
    };

    const handleWindowDrop = (e) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  // Sincronización bidireccional y autoreparación de Favoritos y Reproducciones entre IndexedDB y localStorage
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [dbFavs, dbCounts] = await Promise.all([
          getFavoritesFromDB(),
          getPlayCountsFromDB()
        ]);

        if (!isMounted) return;

        // 1. Reconciliación de Favoritos
        if (dbFavs && Array.isArray(dbFavs) && dbFavs.length > 0) {
          setFavorites(prev => {
            if (!prev || prev.length === 0) {
              try {
                localStorage.setItem('musicPlayer_favorites', JSON.stringify(dbFavs));
              } catch (e) {}
              return dbFavs;
            }
            const existingKeys = new Set(prev.map(f => typeof f === 'object' ? f.key : f));
            const toAdd = dbFavs.filter(f => {
              const k = typeof f === 'object' ? f.key : f;
              return !existingKeys.has(k);
            });
            if (toAdd.length > 0) {
              const merged = [...prev, ...toAdd];
              try {
                localStorage.setItem('musicPlayer_favorites', JSON.stringify(merged));
              } catch (e) {}
              return merged;
            }
            return prev;
          });
        } else if (favorites && favorites.length > 0) {
          saveFavoritesToDB(favorites);
        }

        // 2. Reconciliación de Reproducciones (Play Counts)
        if (dbCounts && typeof dbCounts === 'object' && Object.keys(dbCounts).length > 0) {
          setPlayCounts(prev => {
            const merged = { ...dbCounts, ...prev };
            try {
              localStorage.setItem('musicPlayer_playCounts', JSON.stringify(merged));
            } catch (e) {}
            return merged;
          });
        } else if (playCounts && Object.keys(playCounts).length > 0) {
          savePlayCountsToDB(playCounts);
        }
      } catch (err) {
        console.warn('Error sincronizando favoritos o reproducciones desde IndexedDB:', err);
      }
    })();

    return () => { isMounted = false; };
  }, []);

  // Clave semántica permanente basada en la identidad musical intrínseca (Título + Artista)
  // "Resistencia de cariño": inmune a reubicaciones de carpetas, cambio de disco o recargas
  const getSongKey = (s) => {
    if (!s) return '';
    const cleanTitle = normalizeText(s.title || '').replace(/\.[a-z0-9]+$/i, '').trim() ||
                       normalizeText(s.filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    const rawArtist = (s.artist || '').trim();
    const cleanArtist = normalizeText(rawArtist);

    if (cleanArtist && cleanArtist !== 'desconocido' && cleanArtist !== 'unknown') {
      return `track::${cleanTitle}:::${cleanArtist}`;
    }
    return `track::${cleanTitle || 'pista'}`;
  };

  const isCurrentSong = (s) => {
    if (!s) return false;
    const current = selectedSong || activeSong;
    if (!current) return false;
    if (s.id !== undefined && current.id !== undefined && s.id === current.id) return true;
    const keyA = getSongKey(s);
    const keyB = getSongKey(current);
    return Boolean(keyA && keyB && keyA === keyB);
  };

  const isSongFavorite = (s) => {
    if (!s || !favorites || favorites.length === 0) return false;
    const currentKey = getSongKey(s);
    const cleanTitle = normalizeText(s.title || '').replace(/\.[a-z0-9]+$/i, '').trim() ||
                       normalizeText(s.filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    const rawArtist = (s.artist || '').trim();
    const cleanArtist = normalizeText(rawArtist);
    const cleanFilename = normalizeText(s.filename || '').trim();
    const cleanPath = s.path ? String(s.path).toLowerCase().trim() : '';
    const legacyKey = `${s.artist || 'Desconocido'}___${s.title || s.filename}`;

    return favorites.some(fav => {
      if (typeof fav === 'string') {
        if (fav === currentKey) return true;
        if (fav === legacyKey) return true;
        if (cleanPath && fav.toLowerCase().trim() === cleanPath) return true;
        if (cleanTitle && (fav === `track::${cleanTitle}` || fav === cleanTitle)) return true;
        return false;
      }

      if (fav && typeof fav === 'object') {
        if (fav.key === currentKey || fav.key === legacyKey) return true;

        const favTitle = normalizeText(fav.title || '').replace(/\.[a-z0-9]+$/i, '').trim() ||
                         normalizeText(fav.filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
        const favArtist = normalizeText(fav.artist || '').trim();

        if (cleanTitle && favTitle && cleanTitle === favTitle) {
          const hasSongArtist = cleanArtist && cleanArtist !== 'desconocido' && cleanArtist !== 'unknown';
          const hasFavArtist = favArtist && favArtist !== 'desconocido' && favArtist !== 'unknown';

          if (hasSongArtist && hasFavArtist) {
            if (cleanArtist === favArtist) return true;
          } else {
            return true;
          }
        }

        if (cleanFilename && fav.filename) {
          const favFilename = normalizeText(fav.filename).trim();
          if (cleanFilename === favFilename) return true;
        }

        if (cleanPath && fav.path && fav.path.toLowerCase().trim() === cleanPath) {
          return true;
        }
      }

      return false;
    });
  };

  const toggleFavorite = (s) => {
    if (!s) return;
    const key = getSongKey(s);
    const wasFav = isSongFavorite(s);

    setFavorites(prev => {
      let next;
      if (wasFav) {
        const cleanTitle = normalizeText(s.title || '').replace(/\.[a-z0-9]+$/i, '').trim() ||
                           normalizeText(s.filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
        const cleanArtist = normalizeText(s.artist || '').trim();
        const cleanFilename = normalizeText(s.filename || '').trim();
        const cleanPath = s.path ? String(s.path).toLowerCase().trim() : '';
        const legacyKey = `${s.artist || 'Desconocido'}___${s.title || s.filename}`;

        next = prev.filter(fav => {
          if (typeof fav === 'string') {
            if (fav === key || fav === legacyKey) return false;
            if (cleanPath && fav.toLowerCase().trim() === cleanPath) return false;
            if (cleanTitle && (fav === `track::${cleanTitle}` || fav === cleanTitle)) return false;
            return true;
          }
          if (fav && typeof fav === 'object') {
            if (fav.key === key || fav.key === legacyKey) return false;
            const favTitle = normalizeText(fav.title || '').replace(/\.[a-z0-9]+$/i, '').trim() ||
                             normalizeText(fav.filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
            const favArtist = normalizeText(fav.artist || '').trim();

            if (cleanTitle && favTitle && cleanTitle === favTitle) {
              const hasSongArtist = cleanArtist && cleanArtist !== 'desconocido' && cleanArtist !== 'unknown';
              const hasFavArtist = favArtist && favArtist !== 'desconocido' && favArtist !== 'unknown';
              if (hasSongArtist && hasFavArtist) {
                if (cleanArtist === favArtist) return false;
              } else {
                return false;
              }
            }
            if (cleanFilename && fav.filename && cleanFilename === normalizeText(fav.filename).trim()) return false;
            if (cleanPath && fav.path && fav.path.toLowerCase().trim() === cleanPath) return false;
          }
          return true;
        });
      } else {
        const favRecord = {
          key,
          title: s.title || (s.filename ? s.filename.replace(/\.[a-z0-9]+$/i, '') : 'Pista'),
          artist: s.artist || 'Desconocido',
          album: s.album || 'Desconocido',
          filename: s.filename || '',
          duration: s.duration || 0,
          path: s.path || '',
          addedAt: Date.now()
        };
        next = [...prev, favRecord];
      }

      try {
        localStorage.setItem('musicPlayer_favorites', JSON.stringify(next));
      } catch (e) {
        console.warn('Error guardando favoritos en localStorage:', e);
      }
      saveFavoritesToDB(next);

      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: {
          message: wasFav
            ? `Eliminada de Favoritas: ${s.title || s.filename}`
            : `Añadida a Favoritas: ${s.title || s.filename}`
        }
      }));

      return next;
    });
  };

  useEffect(() => {
    const handleToggleFav = () => {
      if (activeSong) {
        toggleFavorite(activeSong);
      }
    };
    window.addEventListener('musicPlayer_toggleCurrentFavorite', handleToggleFav);
    return () => window.removeEventListener('musicPlayer_toggleCurrentFavorite', handleToggleFav);
  }, [activeSong]);

  const getSongPlayCount = (s) => {
    if (!s || !playCounts) return 0;
    const key = getSongKey(s);
    if (playCounts[key] !== undefined) return playCounts[key];
    const legacyKey = `${s.artist || 'Desconocido'}___${s.title || s.filename}`;
    if (playCounts[legacyKey] !== undefined) return playCounts[legacyKey];
    if (s.path && playCounts[s.path] !== undefined) return playCounts[s.path];
    return 0;
  };

  const incrementPlayCount = (s) => {
    if (!s) return;
    const key = getSongKey(s);
    setPlayCounts(prev => {
      const currentCount = prev[key] !== undefined
        ? prev[key]
        : (prev[`${s.artist || 'Desconocido'}___${s.title || s.filename}`] !== undefined
            ? prev[`${s.artist || 'Desconocido'}___${s.title || s.filename}`]
            : (s.path && prev[s.path] !== undefined ? prev[s.path] : 0));

      const next = { ...prev, [key]: currentCount + 1 };
      try {
        localStorage.setItem('musicPlayer_playCounts', JSON.stringify(next));
      } catch (e) {
        console.warn('Error guardando playCounts en localStorage:', e);
      }
      savePlayCountsToDB(next);
      return next;
    });
  };

  // Conteos reactivos para Chips de Filtros Rápidos
  const favoritesCount = useMemo(() => {
    return songs.filter(s => isSongFavorite(s)).length;
  }, [songs, favorites]);

  const discoveriesCount = useMemo(() => {
    return songs.filter(s => {
      const key = getSongKey(s);
      const count = playCounts[key] !== undefined
        ? playCounts[key]
        : (playCounts[`${s.artist || 'Desconocido'}___${s.title || s.filename}`] !== undefined
            ? playCounts[`${s.artist || 'Desconocido'}___${s.title || s.filename}`]
            : (s.path && playCounts[s.path] !== undefined ? playCounts[s.path] : 0));
      return count === 0;
    }).length;
  }, [songs, playCounts]);

  const recentCount = useMemo(() => {
    if (songs.length === 0) return 0;
    return Math.min(30, Math.ceil(songs.length * 0.25));
  }, [songs]);

  const getSortedAndFilteredSongs = () => {
    let result = baseList ? [...baseList] : [...songs];

    // Filtros Rápidos (Chips de un clic)
    if (libraryFilter === 'favorites') {
      result = result.filter(s => isSongFavorite(s));
    } else if (libraryFilter === 'recent') {
      const threshold = songs.length - Math.min(30, Math.ceil(songs.length * 0.25));
      result = result.filter(s => (s.id !== undefined ? s.id : 0) >= threshold);
    } else if (libraryFilter === 'discoveries') {
      result = result.filter(s => {
        const key = getSongKey(s);
        const count = playCounts[key] !== undefined
          ? playCounts[key]
          : (playCounts[`${s.artist || 'Desconocido'}___${s.title || s.filename}`] !== undefined
              ? playCounts[`${s.artist || 'Desconocido'}___${s.title || s.filename}`]
              : (s.path && playCounts[s.path] !== undefined ? playCounts[s.path] : 0));
        return count === 0;
      });
    }

    if (searchQuery) {
      const q = normalizeText(searchQuery);
      result = result.filter(s =>
        normalizeText(s.title).includes(q) ||
        normalizeText(s.artist).includes(q) ||
        normalizeText(s.album).includes(q)
      );
    }
    result.sort((a, b) => {
      const aVal = normalizeText(a[sortConfig.key]);
      const bVal = normalizeText(b[sortConfig.key]);
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  };

  const displaySongs = getSortedAndFilteredSongs();

  // Control y seguimiento de scroll dinámico en la lista de la biblioteca
  const lastScrolledTrackKeyRef = useRef(null);
  const prevActiveTabRef = useRef(activeTab);

  const scrollToCurrentTrack = (force = false) => {
    const currentTrack = selectedSong || activeSong;
    if (!currentTrack) return false;
    const trackId = currentTrack.id ?? getSongKey(currentTrack);
    if (trackId === undefined || trackId === null) return false;

    if (!force && lastScrolledTrackKeyRef.current === trackId) {
      return true;
    }

    const container = tableContainerRef.current;
    if (!container) return false;

    // Buscar elemento de la fila por ID numérico/texto o data attributes
    let row = null;
    if (currentTrack.id !== undefined && currentTrack.id !== null) {
      row = document.getElementById(`song-row-${currentTrack.id}`) ||
            container.querySelector(`[data-song-id="${currentTrack.id}"]`);
    }
    if (!row) {
      const key = getSongKey(currentTrack);
      if (key) {
        try {
          row = container.querySelector(`[data-song-key="${CSS.escape(key)}"]`);
        } catch (e) {}
      }
    }
    if (!row && currentTrack.path) {
      try {
        row = container.querySelector(`[data-song-path="${CSS.escape(currentTrack.path)}"]`);
      } catch (e) {}
    }

    if (row) {
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const currentScroll = container.scrollTop;

      // Cálculo matemático exacto para centrar la fila dentro del contenedor con scroll independiente
      const rowRelativeTop = (rowRect.top - containerRect.top) + currentScroll;
      const targetScroll = rowRelativeTop - (container.clientHeight / 2) + (row.offsetHeight / 2);
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const clampedScroll = Math.max(0, Math.min(targetScroll, maxScroll));

      container.scrollTo({
        top: clampedScroll,
        behavior: 'smooth'
      });

      lastScrolledTrackKeyRef.current = trackId;
      return true;
    }
    return false;
  };

  // Focus dinámico suave y seguimiento automático de la pista en reproducción
  const currentPlayingTrack = selectedSong || activeSong;
  const currentPlayingTrackKey = currentPlayingTrack?.id ?? (currentPlayingTrack ? getSongKey(currentPlayingTrack) : null);

  useEffect(() => {
    if (activeTab !== 'library') {
      prevActiveTabRef.current = activeTab;
      return;
    }

    if (!currentPlayingTrack || currentPlayingTrackKey === null || currentPlayingTrackKey === undefined) {
      prevActiveTabRef.current = 'library';
      return;
    }

    const tabJustSwitchedToLibrary = prevActiveTabRef.current !== 'library';
    prevActiveTabRef.current = 'library';

    // Si la canción no ha cambiado y no acabamos de cambiar a la biblioteca, respetar el scroll manual del usuario
    if (!tabJustSwitchedToLibrary && lastScrolledTrackKeyRef.current === currentPlayingTrackKey) {
      return;
    }

    let isCancelled = false;
    let attempts = 0;

    const performScroll = () => {
      if (isCancelled) return;
      const container = tableContainerRef.current;
      if (!container || (container.clientHeight === 0 && attempts < 12)) {
        attempts++;
        setTimeout(performScroll, 40);
        return;
      }

      const done = scrollToCurrentTrack(tabJustSwitchedToLibrary);
      if (!done && attempts < 8) {
        attempts++;
        setTimeout(performScroll, 50);
      }
    };

    const timer = setTimeout(performScroll, 60);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [currentPlayingTrackKey, activeTab, baseList]);

  // Arrastrar y Soltar directo a la ventana inteligente (Buffeado)
  const handleSmartDrop = async (e, targetZone = 'library') => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    setStatusMessage('Analizando elementos arrastrados...');

    const items = e.dataTransfer ? e.dataTransfer.items : null;
    let allFiles = [];

    if (items && items.length > 0) {
      const entryPromises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entryPromises.push(scanEntryRecursively(entry));
          }
        } else if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) entryPromises.push(Promise.resolve([f]));
        }
      }
      const nested = await Promise.all(entryPromises);
      allFiles = nested.flat();
    }

    if (allFiles.length === 0 && e.dataTransfer && e.dataTransfer.files) {
      allFiles = Array.from(e.dataTransfer.files);
    }

    const audioFiles = allFiles.filter(f => f.name.match(/\.(mp3|flac|m4a|wav|ogg)$/i));
    const imageFiles = allFiles.filter(f => isAnyImageName(f.name));

    if (audioFiles.length === 0) {
      setErrorMessage('No se encontraron archivos de audio compatibles (.mp3, .flac, .m4a, .wav, .ogg).');
      return;
    }

    // Pre-indexar carátulas de carpetas
    const folderImages = new Map();
    for (const img of imageFiles) {
      const rel = (img.webkitRelativePath || img.name).toLowerCase();
      const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
      const isDedicated = isFolderCoverName(img.name);
      if (!folderImages.has(dir) || isDedicated) {
        folderImages.set(dir, img);
      }
    }

    if (targetZone === 'queue') {
      setStatusMessage(`Añadiendo ${audioFiles.length} pista(s) a la cola de reproducción...`);
      const newQueueItems = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        try {
          const metadata = await musicMetadata.parseBlob(file);
          let pictureUrl = null;
          let pictureBlob = null;
          let isSquareCover = true;

          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            const blob = new Blob([pic.data], { type: pic.format });
            pictureBlob = blob;
            pictureUrl = URL.createObjectURL(blob);
            const dims = await getImageDimensions(pictureUrl);
            if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) isSquareCover = false;
          } else {
            const rel = (file.webkitRelativePath || file.name).toLowerCase();
            const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
            const folderImg = folderImages.get(dir) || folderImages.get('');
            if (folderImg) {
              pictureBlob = folderImg;
              pictureUrl = URL.createObjectURL(folderImg);
              const dims = await getImageDimensions(pictureUrl);
              if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) isSquareCover = false;
            }
          }

          const songObj = {
            id: `queue_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
            filename: file.name,
            rawFile: file,
            title: metadata.common.title || file.name.split('.')[0],
            artist: metadata.common.artist || 'Desconocido',
            album: metadata.common.album || 'Desconocido',
            genre: metadata.common.genre ? metadata.common.genre.join(', ') : 'Desconocido',
            year: metadata.common.year || 'N/A',
            bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) + ' kbps' : 'N/A',
            codec: metadata.format.codec || 'N/A',
            path: file.webkitRelativePath || file.name,
            cover: pictureUrl,
            coverBlob: pictureBlob,
            isSquareCover,
            duration: metadata.format.duration || 0,
            trackGain: metadata.common.replaygain_track_gain || null
          };
          newQueueItems.push(songObj);
        } catch (err) {
          console.warn('Error leyendo metadata de archivo arrastrado:', file.name, err);
        }
      }

      if (newQueueItems.length > 0) {
        setPlayQueue(prev => [...prev, ...newQueueItems]);
        setStatusMessage(`¡${newQueueItems.length} pista(s) añadidas a la cola!`);
        if (!activeSong) {
          handleSelectSong(newQueueItems[0]);
        }
      }
    } else {
      // targetZone === 'library'
      if (songs.length === 0) {
        await processFiles([...audioFiles, ...imageFiles]);
        return;
      }

      setStatusMessage(`Integrando ${audioFiles.length} pista(s) a la biblioteca actual...`);
      const newSongs = [];
      const startIndex = songs.length;

      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        try {
          const metadata = await musicMetadata.parseBlob(file);
          let pictureUrl = null;
          let pictureBlob = null;
          let isSquareCover = true;

          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            const blob = new Blob([pic.data], { type: pic.format });
            pictureBlob = blob;
            pictureUrl = URL.createObjectURL(blob);
            const dims = await getImageDimensions(pictureUrl);
            if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) isSquareCover = false;
          } else {
            const rel = (file.webkitRelativePath || file.name).toLowerCase();
            const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
            const folderImg = folderImages.get(dir) || folderImages.get('');
            if (folderImg) {
              pictureBlob = folderImg;
              pictureUrl = URL.createObjectURL(folderImg);
              const dims = await getImageDimensions(pictureUrl);
              if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) isSquareCover = false;
            }
          }

          const songObj = {
            id: startIndex + i,
            filename: file.name,
            rawFile: file,
            title: metadata.common.title || file.name.split('.')[0],
            artist: metadata.common.artist || 'Desconocido',
            album: metadata.common.album || 'Desconocido',
            genre: metadata.common.genre ? metadata.common.genre.join(', ') : 'Desconocido',
            year: metadata.common.year || 'N/A',
            bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) + ' kbps' : 'N/A',
            codec: metadata.format.codec || 'N/A',
            path: file.webkitRelativePath || file.name,
            cover: pictureUrl,
            coverBlob: pictureBlob,
            isSquareCover,
            duration: metadata.format.duration || 0,
            trackGain: metadata.common.replaygain_track_gain || null
          };
          newSongs.push(songObj);
        } catch (err) {
          console.warn('Error leyendo metadata de archivo arrastrado:', file.name, err);
        }
      }

      if (newSongs.length > 0) {
        const updatedLibrary = [...songs, ...newSongs];
        setSongs(updatedLibrary);
        await saveCachedLibrary(updatedLibrary);
        setStatusMessage(`¡${newSongs.length} pista(s) añadidas a tu biblioteca!`);
        if (!activeSong) {
          handleSelectSong(newSongs[0]);
        }
      }
    }
  };

  const handleSelectSong = async (song, isManual = true) => {
    if (isManual) {
      setRandomHistory([]);
      setRandomHistoryIndex(-1);
    }
    if (!song) {
      setHighlightedSong(null);
      setSelectedSong(null);
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        setCurrentAudioUrl(null);
      }
      return;
    }

    setHighlightedSong(song);
    setSelectedSong(song);
    incrementPlayCount(song);

    let targetFile = song.rawFile;

    // 1. Revisar en almacenamiento permanente local (OPFS - 0 ms de arranque, Cero permisos ni explorador)
    if (!targetFile) {
      try {
        const opfsFile = await getTrackFromOPFS(song);
        if (opfsFile) {
          targetFile = opfsFile;
          song.rawFile = targetFile;
        }
      } catch (opfsErr) {
        console.warn('Error leyendo pista de OPFS:', opfsErr);
      }
    }

    // 2. Si ya se tiene fileEntry pero aún no se ha obtenido el File
    if (!targetFile && song.fileEntry) {
      try {
        targetFile = await song.fileEntry.getFile();
        song.rawFile = targetFile;
      } catch (err) {
        console.warn('Error leyendo File de fileEntry:', err);
      }
    }

    // 3. Si cachedFileMapRef tiene la entrada indexada
    if (!targetFile && cachedFileMapRef.current && cachedFileMapRef.current.size > 0) {
      const keyPath = (song.path || '').toLowerCase();
      const keyName = (song.filename || '').toLowerCase();
      const entry = cachedFileMapRef.current.get(keyPath) || cachedFileMapRef.current.get(keyName);
      if (entry) {
        try {
          targetFile = await entry.getFile();
          song.rawFile = targetFile;
          song.fileEntry = entry;
        } catch (err) {
          console.warn('Error obteniendo File de cachedFileMap:', err);
        }
      }
    }

    // 4. Si aún no tenemos archivo y hay un handle de carpeta guardado (solicitamos permiso)
    const dirHandle = savedDirHandleRef.current || savedFolderInfo?.handle;
    if (!targetFile && dirHandle) {
      try {
        let perm = 'granted';
        if (dirHandle.requestPermission) {
          perm = await dirHandle.requestPermission({ mode: 'read' });
        }
        if (perm === 'granted') {
          setHasDiskPermission(true);
          savedDirHandleRef.current = dirHandle;
          await linkFilesFromDirectoryHandle(dirHandle);
          const keyPath = (song.path || '').toLowerCase();
          const keyName = (song.filename || '').toLowerCase();
          const entry = cachedFileMapRef.current?.get(keyPath) || cachedFileMapRef.current?.get(keyName);
          if (entry) {
            targetFile = await entry.getFile();
            song.rawFile = targetFile;
            song.fileEntry = entry;
          }
        } else {
          window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
            detail: { message: 'Se requiere permiso de lectura para reproducir la canción.', isError: true }
          }));
          return;
        }
      } catch (err) {
        console.warn('Error solicitando permisos en handleSelectSong:', err);
        return;
      }
    }

    if (!targetFile) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: `No se pudo acceder al archivo de audio para "${song.title}". Reconecta la carpeta.`, isError: true }
      }));
      return;
    }

    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioUrl(null);
    }
    setCurrentAudioUrl(URL.createObjectURL(targetFile));
  };

  // ==========================================
  // COLA DE REPRODUCCIÓN DINÁMICA («A continuación»)
  // ==========================================
  const addToQueueNext = (song) => {
    if (!song) return;
    setPlayQueue(prev => [song, ...prev.filter(s => s.id !== song.id)]);
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `Reproducir a continuación: ${song.title}` }
    }));
  };

  const addToQueueEnd = (song) => {
    if (!song) return;
    setPlayQueue(prev => [...prev.filter(s => s.id !== song.id), song]);
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `Añadida a la cola: ${song.title}` }
    }));
  };

  const removeFromQueue = (index) => {
    setPlayQueue(prev => prev.filter((_, i) => i !== index));
  };

  const moveQueueItem = (fromIdx, toIdx) => {
    setPlayQueue(prev => {
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, item);
      return copy;
    });
  };

  const clearQueue = () => {
    setPlayQueue([]);
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: 'Cola de reproducción vaciada.' }
    }));
  };

  const playFromQueue = (index) => {
    setPlayQueue(prev => {
      const targetSong = prev[index];
      if (targetSong) {
        handleSelectSong(targetSong, false);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // ==========================================
  // MENÚ CONTEXTUAL Y BLOQUEO DE CLIC DERECHO
  // ==========================================
  const handleSongContextMenu = (e, song) => {
    e.preventDefault();
    e.stopPropagation();
    setHighlightedSong(song);

    const menuWidth = 240;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      visible: true,
      x: Math.max(10, x),
      y: Math.max(10, y),
      song
    });
  };

  const copySongInfo = (song) => {
    if (!song) return;
    const text = `${song.title} - ${song.artist}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `Copiado: ${text}` }
    }));
  };

  // Desaparición inteligente del menú contextual de una canción
  useEffect(() => {
    if (isIdle) {
      setContextMenu(prev => prev.visible ? { ...prev, visible: false, song: null } : prev);
    }
  }, [isIdle]);

  useEffect(() => {
    setContextMenu(prev => prev.visible ? { ...prev, visible: false, song: null } : prev);
  }, [activeTab]);

  useEffect(() => {
    const handleGlobalContextMenu = (e) => {
      // Bloquear el menú contextual por defecto del navegador en toda la app
      // Respetar únicamente campos de texto interactivos (inputs/textareas)
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
    };
    const handleDismissContextMenu = () => {
      setContextMenu(prev => prev.visible ? { ...prev, visible: false, song: null } : prev);
    };
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleDismissContextMenu();
      }
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    window.addEventListener('click', handleDismissContextMenu);
    window.addEventListener('scroll', handleDismissContextMenu, true);
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('blur', handleDismissContextMenu);
    window.addEventListener('resize', handleDismissContextMenu);
    document.addEventListener('visibilitychange', handleDismissContextMenu);

    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
      window.removeEventListener('click', handleDismissContextMenu);
      window.removeEventListener('scroll', handleDismissContextMenu, true);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('blur', handleDismissContextMenu);
      window.removeEventListener('resize', handleDismissContextMenu);
      document.removeEventListener('visibilitychange', handleDismissContextMenu);
    };
  }, []);

  // ==========================================
  // GESTIÓN GLOBAL DE RESPALDOS Y EXPORTACIÓN
  // ==========================================
  const exportGlobalBackup = () => {
    try {
      const backupData = {
        appName: 'Reproductor de música',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        favorites,
        playCounts,
        customSmartPlaylists,
        customAccentColors,
        settings: {
          volume: parseFloat(localStorage.getItem('musicPlayer_volume') || '100'),
          accentColor,
          customAccentColors,
          sleepTimerEndAction,
          sleepTimerFadeSeconds,
          repeat: localStorage.getItem('musicPlayer_repeat') || '0',
          random: localStorage.getItem('musicPlayer_random') === 'true',
          smoothFade,
          crossfadeDuration: localStorage.getItem('musicPlayer_crossfadeDuration') || '2',
          easterEggsEnabled,
          hotkeys: localStorage.getItem('musicPlayer_hotkeys') ? JSON.parse(localStorage.getItem('musicPlayer_hotkeys')) : null
        }
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `respaldo_reproductor_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: `Copia de seguridad exportada con éxito (${favorites.length} favoritas)` }
      }));
    } catch (err) {
      console.error('Error exportando respaldo:', err);
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Error al generar el archivo de respaldo.' }
      }));
    }
  };

  const handleBackupFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Archivo inválido');
        }
        setPendingImportData(parsed);
        setShowImportModal(true);
      } catch (err) {
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: { message: 'El archivo seleccionado no es un respaldo JSON válido.' }
        }));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyGlobalBackup = () => {
    if (!pendingImportData) return;
    try {
      const {
        favorites: importedFavs,
        playCounts: importedCounts,
        customSmartPlaylists: importedSmart,
        customAccentColors: rootCustomColors,
        settings: importedSettings
      } = pendingImportData;

      if (Array.isArray(importedFavs)) {
        setFavorites(importedFavs);
        try { localStorage.setItem('musicPlayer_favorites', JSON.stringify(importedFavs)); } catch (e) {}
        saveFavoritesToDB(importedFavs);
      }

      if (importedCounts && typeof importedCounts === 'object') {
        setPlayCounts(importedCounts);
        try { localStorage.setItem('musicPlayer_playCounts', JSON.stringify(importedCounts)); } catch (e) {}
        savePlayCountsToDB(importedCounts);
      }

      if (Array.isArray(importedSmart)) {
        setCustomSmartPlaylists(importedSmart);
        try { localStorage.setItem('musicPlayer_smartPlaylists', JSON.stringify(importedSmart)); } catch (e) {}
      }

      const importedCustomColors = rootCustomColors || (importedSettings && importedSettings.customAccentColors);
      if (Array.isArray(importedCustomColors)) {
        setCustomAccentColors(importedCustomColors);
        try { localStorage.setItem('musicPlayer_customAccentColors', JSON.stringify(importedCustomColors)); } catch (e) {}
      }

      if (importedSettings && typeof importedSettings === 'object') {
        if (importedSettings.volume !== undefined) {
          try {
            const volVal = String(importedSettings.volume);
            localStorage.setItem('musicPlayer_volume', volVal);
            window.dispatchEvent(new CustomEvent('musicPlayer_volumeFeedback', {
              detail: { volume: parseFloat(volVal), isMuted: false }
            }));
          } catch (e) {}
        }
        if (importedSettings.accentColor) {
          setAccentColor(importedSettings.accentColor);
          try { localStorage.setItem('musicPlayer_accentColor', importedSettings.accentColor); } catch (e) {}
          document.documentElement.style.setProperty('--accent-color', importedSettings.accentColor);
        }
        if (importedSettings.sleepTimerEndAction) {
          setSleepTimerEndAction(importedSettings.sleepTimerEndAction);
          try { localStorage.setItem('musicPlayer_sleepTimerEndAction', importedSettings.sleepTimerEndAction); } catch (e) {}
        }
        if (importedSettings.sleepTimerFadeSeconds !== undefined) {
          const fadeSecs = parseInt(importedSettings.sleepTimerFadeSeconds, 10) || 0;
          setSleepTimerFadeSeconds(fadeSecs);
          try { localStorage.setItem('musicPlayer_sleepTimerFadeSeconds', String(fadeSecs)); } catch (e) {}
        }
        if (importedSettings.smoothFade !== undefined) {
          setSmoothFade(Boolean(importedSettings.smoothFade));
          try { localStorage.setItem('musicPlayer_smoothFade', String(importedSettings.smoothFade)); } catch (e) {}
        }
        if (importedSettings.easterEggsEnabled !== undefined) {
          setEasterEggsEnabled(Boolean(importedSettings.easterEggsEnabled));
          try { localStorage.setItem('musicPlayer_easterEggs', String(importedSettings.easterEggsEnabled)); } catch (e) {}
        }
        if (importedSettings.hotkeys) {
          setHotkeys(importedSettings.hotkeys);
          try { localStorage.setItem('musicPlayer_hotkeys', JSON.stringify(importedSettings.hotkeys)); } catch (e) {}
        }
      }

      setShowImportModal(false);
      setPendingImportData(null);
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: '¡Copia de seguridad restaurada con éxito! Favoritas y datos actualizados.' }
      }));
    } catch (err) {
      console.error('Error aplicando respaldo:', err);
    }
  };

  const exportFavoritesM3U8 = () => {
    const favSongs = songs.filter(s => isSongFavorite(s));
    if (favSongs.length === 0) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'No hay canciones en Favoritas para exportar.' }
      }));
      return;
    }

    let m3u = '#EXTM3U\n';
    m3u += '#PLAYLIST:Canciones Favoritas\n\n';
    favSongs.forEach(s => {
      const dur = Math.round(s.duration || 0);
      m3u += `#EXTINF:${dur},${s.artist || 'Desconocido'} - ${s.title || s.filename}\n`;
      m3u += `${s.path || s.filename}\n\n`;
    });

    const blob = new Blob([m3u], { type: 'audio/x-mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `favoritas_${new Date().toISOString().slice(0, 10)}.m3u8`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `Lista M3U8 descargada con ${favSongs.length} canciones.` }
    }));
  };

  const exportStatsJSON = () => {
    if (!stats) return;
    const statsData = {
      generadoEl: new Date().toISOString(),
      cancionesTotales: stats.totalSongs,
      artistasUnicos: stats.uniqueArtists,
      albumesUnicos: stats.uniqueAlbums,
      tiempoTotalFormato: stats.formattedDuration,
      calidadHiFi: stats.highQualityCount,
      generosTop: stats.topGenres,
      decadas: stats.decades
    };
    const jsonStr = JSON.stringify(statsData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estadisticas_biblioteca_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: 'Estadísticas JSON exportadas con éxito.' }
    }));
  };

  const playNext = (repeatMode = 0, isRandom = false) => {
    // 1. Si hay canciones en la cola de reproducción prioritaria, tomamos la primera
    if (playQueue.length > 0) {
      const nextFromQueue = playQueue[0];
      setPlayQueue(prev => prev.slice(1));
      handleSelectSong(nextFromQueue, false);
      return true;
    }

    if (!displaySongs || displaySongs.length === 0 || !selectedSong) return false;
    if (repeatMode === 2) {
      handleSelectSong(selectedSong, false);
      return true;
    }
    if (isRandom) {
      let selectedToPlay = null;
      if (randomHistoryIndex < randomHistory.length - 1 && randomHistory.length > 0) {
        const nextIndex = randomHistoryIndex + 1;
        setRandomHistoryIndex(nextIndex);
        selectedToPlay = randomHistory[nextIndex];
      } else {
        const randomIdx = Math.floor(Math.random() * displaySongs.length);
        selectedToPlay = displaySongs[randomIdx];
        setRandomHistory(prev => {
          const newList = prev.slice(0, randomHistoryIndex + 1);
          if (newList.length === 0) newList.push(selectedSong);
          newList.push(selectedToPlay);
          setRandomHistoryIndex(newList.length - 1);
          return newList;
        });
      }
      handleSelectSong(selectedToPlay, false);
      return true;
    }
    const idx = displaySongs.findIndex(s => s.id === selectedSong.id);
    if (idx !== -1) {
      if (idx < displaySongs.length - 1) {
        handleSelectSong(displaySongs[idx + 1], true);
        return true;
      } else {
        if (repeatMode === 1) {
          handleSelectSong(displaySongs[0], true);
          return true;
        } else {
          return false;
        }
      }
    }
    return false;
  };

  const playPrev = (repeatMode = 0, isRandom = false) => {
    if (!displaySongs || displaySongs.length === 0 || !selectedSong) return false;
    if (repeatMode === 2) {
      handleSelectSong(selectedSong, false);
      return true;
    }
    if (isRandom) {
      if (randomHistoryIndex > 0) {
        const prevIndex = randomHistoryIndex - 1;
        setRandomHistoryIndex(prevIndex);
        const prevSongToPlay = randomHistory[prevIndex];
        handleSelectSong(prevSongToPlay, false);
        return true;
      } else if (randomHistory.length === 0) {
        const idx = displaySongs.findIndex(s => s.id === selectedSong.id);
        let prevSongToPlay = null;
        if (idx > 0) {
          prevSongToPlay = displaySongs[idx - 1];
        } else if (repeatMode === 1 && displaySongs.length > 0) {
          prevSongToPlay = displaySongs[displaySongs.length - 1];
        }
        if (prevSongToPlay) {
          handleSelectSong(prevSongToPlay, true);
          return true;
        }
      }
      return false;
    }
    const idx = displaySongs.findIndex(s => s.id === selectedSong.id);
    if (idx > 0) {
      handleSelectSong(displaySongs[idx - 1], true);
      return true;
    } else if (idx === 0 && repeatMode === 1 && displaySongs.length > 0) {
      handleSelectSong(displaySongs[displaySongs.length - 1], true);
      return true;
    }
    return false;
  };

  const processFiles = async (files) => {
    setIsScanning(true);
    setScanProgress(0);
    setErrorMessage('');
    setStatusMessage('Buscando archivos de audio...');
    const parsedSongs = [];
    handleSelectSong(null);
    setHighlightedSong(null);
    setBaseList(null);
    setPlaylistTitle('Biblioteca General');
    setModalData(null);

    try {
      const audioFiles = Array.from(files).filter(file =>
        file.name.match(/\.(mp3|flac|m4a|wav|ogg)$/i)
      );
      const imageFiles = Array.from(files).filter(file => isAnyImageName(file.name));

      // Mapeo inteligente de carátulas de carpeta (cover.jpg, folder.jpg, album.jpg, front.jpg, etc.)
      const folderImages = new Map();
      for (const img of imageFiles) {
        const rel = (img.webkitRelativePath || img.name).toLowerCase();
        const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
        const isDedicated = isFolderCoverName(img.name);
        if (!folderImages.has(dir) || isDedicated) {
          folderImages.set(dir, img);
        }
      }

      if (audioFiles.length === 0) {
        setErrorMessage("No se encontraron archivos de música válidos en esta carpeta.");
        setIsScanning(false);
        return;
      }

      const limit = audioFiles.length;

      for (let i = 0; i < limit; i++) {
        const file = audioFiles[i];

        if (i % 5 === 0 || i === limit - 1) {
          setStatusMessage(`Analizando (${i + 1}/${limit}): ${file.name}`);
          setScanProgress(Math.round(((i + 1) / limit) * 100));
        }

        try {
          const metadata = await musicMetadata.parseBlob(file);

          let pictureUrl = null;
          let pictureBlob = null;
          let isSquareCover = true;
          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const picture = metadata.common.picture[0];
            const blob = new Blob([picture.data], { type: picture.format });
            pictureBlob = blob;
            pictureUrl = URL.createObjectURL(blob);

            const dims = await getImageDimensions(pictureUrl);
            if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) {
              isSquareCover = false;
            }
          } else {
            // Si la pista no tiene carátula ID3 incrustada, usar carátula de carpeta
            const rel = (file.webkitRelativePath || file.name).toLowerCase();
            const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
            const folderImg = folderImages.get(dir) || folderImages.get('');
            if (folderImg) {
              pictureBlob = folderImg;
              pictureUrl = URL.createObjectURL(folderImg);
              const dims = await getImageDimensions(pictureUrl);
              if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) {
                isSquareCover = false;
              }
            }
          }

          parsedSongs.push({
            id: i,
            filename: file.name,
            rawFile: file,
            title: metadata.common.title || file.name.split('.')[0],
            artist: metadata.common.artist || 'Desconocido',
            album: metadata.common.album || 'Desconocido',
            genre: metadata.common.genre ? metadata.common.genre.join(', ') : 'Desconocido',
            year: metadata.common.year || 'N/A',
            bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) + ' kbps' : 'N/A',
            codec: metadata.format.codec || 'N/A',
            path: file.webkitRelativePath || file.name,
            cover: pictureUrl,
            coverBlob: pictureBlob,
            isSquareCover,
            duration: metadata.format.duration || 0,
            trackGain: metadata.common.replaygain_track_gain || null
          });
        } catch (err) {
          console.error('Error parseando metadatos para', file.name, err);
        }
      }

      setSongs(parsedSongs);
      setHasDiskPermission(true);
      try {
        localStorage.setItem('musicPlayer_hasSavedFolder', 'true');
        localStorage.setItem('musicPlayer_savedSongCount', String(parsedSongs.length));
      } catch (e) {}

      // Guardar en la caché de metadatos de IndexedDB (Arranque instantáneo en 0 ms)
      try {
        await saveCachedLibrary(parsedSongs);
      } catch (cacheErr) {
        console.warn('Error guardando en caché IndexedDB:', cacheErr);
      }

      // Si el almacenamiento permanente OPFS está activado, sincronizar réplicas
      if (isOPFSSupported()) {
        try {
          const autoCloneEnabled = localStorage.getItem('musicPlayer_autoCloneOPFS') === 'true';
          if (autoCloneEnabled) {
            setStatusMessage('Guardando réplica permanente de audio en almacenamiento autónomo (OPFS)...');
            cloneLibraryToOPFS(parsedSongs, (current, total) => {
              setStatusMessage(`Almacenando localmente en OPFS (${current}/${total})...`);
            }).then(({ success, count }) => {
              if (success) {
                setIsClonedToOPFS(true);
                setOpfsTrackCount(count);
                triggerSyncCelebration('Biblioteca Respaldada', `${count} pistas aseguradas permanentemente en disco local`);
              }
            }).catch(e => console.warn('Error en clonación OPFS automática:', e));
          }
        } catch (e) {}
      }

      setStatusMessage('');
      setIsScanning(false);
    } catch (error) {
      console.error("Error al procesar archivos:", error);
      setErrorMessage("Error al procesar los archivos de la carpeta. Verifica los formatos de audio.");
      setIsScanning(false);
    }
  };

  const scanAndProcessDirectoryHandle = async (handle) => {
    scanAndProcessDirectoryHandleRef.current = scanAndProcessDirectoryHandle;
    setIsScanning(true);
    setStatusMessage('Escaneando archivos de audio y carátulas...');
    try {
      let results = [];
      let imgResults = [];
      const scanDirectory = async (h, prefix = '') => {
        for await (const entry of h.values()) {
          if (entry.kind === 'file') {
            if (entry.name.match(/\.(mp3|flac|m4a|wav|ogg)$/i)) {
              results.push({ entry, prefix });
            } else if (isAnyImageName(entry.name)) {
              imgResults.push({ entry, prefix });
            }
          } else if (entry.kind === 'directory') {
            const sub = prefix ? `${prefix}/${entry.name}` : entry.name;
            await scanDirectory(entry, sub);
          }
        }
      };
      await scanDirectory(handle);
      const files = await Promise.all(results.map(async item => {
        const file = await item.entry.getFile();
        if (item.prefix) {
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: `${item.prefix}/${file.name}`,
              configurable: true
            });
          } catch (e) {}
        }
        return file;
      }));
      const imgFiles = await Promise.all(imgResults.map(async item => {
        const file = await item.entry.getFile();
        if (item.prefix) {
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: `${item.prefix}/${file.name}`,
              configurable: true
            });
          } catch (e) {}
        }
        return file;
      }));
      await processFiles([...files, ...imgFiles]);
    } catch (err) {
      console.error('Error escaneando directorio:', err);
      setErrorMessage('No se pudieron leer los archivos de la carpeta seleccionada.');
      setIsScanning(false);
    }
  };
  scanAndProcessDirectoryHandleRef.current = scanAndProcessDirectoryHandle;

  const handleSelectFolder = async () => {
    try {
      if (window.showDirectoryPicker) {
        const dirHandle = await window.showDirectoryPicker();
        const folderName = dirHandle.name || 'Carpeta de música';
        try {
          localStorage.setItem('musicPlayer_hasSavedFolder', 'true');
          localStorage.setItem('musicPlayer_savedFolderName', folderName);
        } catch (e) {}
        savedDirHandleRef.current = dirHandle;
        setSavedFolderInfo({ handle: dirHandle, name: folderName });
        setHasDiskPermission(true);
        await saveDirectoryHandle(dirHandle);
        await scanAndProcessDirectoryHandle(dirHandle);
      } else if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    } catch (error) {
      if (error.name !== 'AbortError' && fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  };

  const syncDirectoryHandle = async (handle) => {
    if (!handle) return;
    setIsScanning(true);
    setStatusMessage('Buscando cambios en la carpeta...');

    try {
      const fileMap = new Map();
      const fileEntries = [];
      const imageEntries = [];

      const walk = async (h, prefix = '') => {
        for await (const entry of h.values()) {
          if (entry.kind === 'file') {
            if (entry.name.match(/\.(mp3|flac|m4a|wav|ogg)$/i)) {
              const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
              fileMap.set(rel.toLowerCase(), entry);
              fileMap.set(entry.name.toLowerCase(), entry);
              fileEntries.push({ rel, entry });
            } else if (isAnyImageName(entry.name)) {
              const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
              imageEntries.push({ rel, entry });
            }
          } else if (entry.kind === 'directory') {
            const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
            await walk(entry, subPrefix);
          }
        }
      };
      await walk(handle);
      cachedFileMapRef.current = fileMap;

      // Extraer carátulas de carpetas
      const folderImages = new Map();
      for (const ie of imageEntries) {
        const rel = ie.rel.toLowerCase();
        const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
        const isDedicated = isFolderCoverName(ie.entry.name);
        if (!folderImages.has(dir) || isDedicated) {
          try {
            const imgFile = await ie.entry.getFile();
            folderImages.set(dir, imgFile);
          } catch (e) {}
        }
      }

      if (!songs || songs.length === 0) {
        const files = await Promise.all(fileEntries.map(fe => fe.entry.getFile()));
        const imgFiles = Array.from(folderImages.values());
        await processFiles([...files, ...imgFiles]);
        return;
      }

      // Identificar canciones existentes válidas y enlazar su fileEntry y carátulas
      const keptSongs = [];
      const existingKeys = new Set();

      for (const song of songs) {
        const keyPath = (song.path || '').toLowerCase();
        const keyName = (song.filename || '').toLowerCase();
        const entry = fileMap.get(keyPath) || fileMap.get(keyName);
        if (entry) {
          existingKeys.add(keyPath);
          existingKeys.add(keyName);
          existingKeys.add(entry.name.toLowerCase());

          let currentCover = song.cover;
          let currentCoverBlob = song.coverBlob;
          let currentIsSquare = song.isSquareCover;

          if (!currentCoverBlob) {
            const dir = keyPath.includes('/') ? keyPath.substring(0, keyPath.lastIndexOf('/')) : '';
            const folderImg = folderImages.get(dir) || folderImages.get('');
            if (folderImg) {
              currentCoverBlob = folderImg;
              currentCover = URL.createObjectURL(folderImg);
              const dims = await getImageDimensions(currentCover);
              if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) {
                currentIsSquare = false;
              }
            }
          }

          keptSongs.push({
            ...song,
            fileEntry: entry,
            cover: currentCover,
            coverBlob: currentCoverBlob,
            isSquareCover: currentIsSquare
          });
        }
      }

      // Archivos nuevos en disco no catalogados aún
      const newEntries = fileEntries.filter(fe => {
        const keyRel = fe.rel.toLowerCase();
        const keyName = fe.entry.name.toLowerCase();
        return !existingKeys.has(keyRel) && !existingKeys.has(keyName);
      });

      let addedSongs = [];
      if (newEntries.length > 0) {
        setStatusMessage(`Analizando ${newEntries.length} nueva(s) pista(s)...`);
        for (let i = 0; i < newEntries.length; i++) {
          const { rel, entry } = newEntries[i];
          try {
            const file = await entry.getFile();
            const metadata = await musicMetadata.parseBlob(file);
            let pictureUrl = null;
            let pictureBlob = null;
            let isSquareCover = true;
            if (metadata.common.picture && metadata.common.picture.length > 0) {
              const picture = metadata.common.picture[0];
              const blob = new Blob([picture.data], { type: picture.format });
              pictureBlob = blob;
              pictureUrl = URL.createObjectURL(blob);
              const dims = await getImageDimensions(pictureUrl);
              if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) {
                isSquareCover = false;
              }
            } else {
              const relLower = (rel || file.name).toLowerCase();
              const dir = relLower.includes('/') ? relLower.substring(0, relLower.lastIndexOf('/')) : '';
              const folderImg = folderImages.get(dir) || folderImages.get('');
              if (folderImg) {
                pictureBlob = folderImg;
                pictureUrl = URL.createObjectURL(folderImg);
                const dims = await getImageDimensions(pictureUrl);
                if (dims.w > 0 && dims.h > 0 && dims.w !== dims.h) {
                  isSquareCover = false;
                }
              }
            }
            addedSongs.push({
              id: keptSongs.length + addedSongs.length,
              filename: file.name,
              rawFile: file,
              fileEntry: entry,
              title: metadata.common.title || file.name.split('.')[0],
              artist: metadata.common.artist || 'Desconocido',
              album: metadata.common.album || 'Desconocido',
              genre: metadata.common.genre ? metadata.common.genre.join(', ') : 'Desconocido',
              year: metadata.common.year || 'N/A',
              bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) + ' kbps' : 'N/A',
              codec: metadata.format.codec || 'N/A',
              path: rel || file.name,
              cover: pictureUrl,
              coverBlob: pictureBlob,
              isSquareCover,
              duration: metadata.format.duration || 0,
              trackGain: metadata.common.replaygain_track_gain || null
            });
          } catch (err) {
            console.warn('Error leyendo metadata de archivo nuevo:', rel, err);
          }
        }
      }

      const updatedSongs = [...keptSongs, ...addedSongs].map((s, idx) => ({ ...s, id: idx }));
      const addedCount = addedSongs.length;
      const deletedCount = songs.length - keptSongs.length;

      // Sincronizar cambios en el almacenamiento permanente local (OPFS)
      if (isOPFSSupported()) {
        // 1. Eliminar canciones que fueron retiradas de la carpeta física
        if (deletedCount > 0) {
          const keptKeys = new Set(keptSongs.map(s => getTrackStorageKey(s)));
          for (const oldSong of songs) {
            const oldKey = getTrackStorageKey(oldSong);
            if (!keptKeys.has(oldKey)) {
              try {
                await deleteTrackFromOPFS(oldKey);
              } catch (e) {}
            }
          }
        }

        // 2. Guardar nuevas canciones añadidas
        if (addedSongs.length > 0) {
          setStatusMessage('Guardando nuevas pistas en memoria local permanente...');
          for (const addedSong of addedSongs) {
            try {
              const k = getTrackStorageKey(addedSong);
              if (addedSong.rawFile) {
                await saveTrackToOPFS(k, addedSong.rawFile);
              }
            } catch (e) {}
          }
        }

        // 3. Si la biblioteca aún no estaba clonada por completo, asegurar clonación ahora
        if (!isClonedToOPFS) {
          setStatusMessage('Asegurando clonación permanente en memoria local...');
          await cloneLibraryToOPFS(updatedSongs, null, fileMap);
        }

        const opfsList = await listOPFSTracks();
        setIsClonedToOPFS(opfsList.length > 0);
        setOpfsTrackCount(opfsList.length);
        const est = await getStorageEstimate();
        if (est) setStorageInfo(est);
      }

      setSongs(updatedSongs);
      setHasDiskPermission(true);
      await saveCachedLibrary(updatedSongs);
      try {
        localStorage.setItem('musicPlayer_hasSavedFolder', 'true');
        localStorage.setItem('musicPlayer_savedSongCount', String(updatedSongs.length));
      } catch (e) {}

      setIsScanning(false);
      setStatusMessage('');
      triggerSyncCelebration(
        'Biblioteca Sincronizada',
        addedCount > 0 || deletedCount > 0
          ? `${updatedSongs.length} canciones al día (${addedCount > 0 ? `+${addedCount} nuevas` : ''}${addedCount > 0 && deletedCount > 0 ? ', ' : ''}${deletedCount > 0 ? `-${deletedCount} retiradas` : ''})`
          : `${updatedSongs.length} canciones al día • Almacenamiento local verificado`
      );

      if (addedCount > 0 || deletedCount > 0) {
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: {
            message: `Sincronización completa: ${updatedSongs.length} canciones (${addedCount > 0 ? `+${addedCount} nuevas` : ''}${addedCount > 0 && deletedCount > 0 ? ', ' : ''}${deletedCount > 0 ? `-${deletedCount} retiradas` : ''}).`
          }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: { message: `Biblioteca al día: ${updatedSongs.length} canciones sincronizadas sin cambios.` }
        }));
      }
    } catch (err) {
      console.error('Error sincronizando carpeta:', err);
      setIsScanning(false);
      setStatusMessage('');
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Error al sincronizar la carpeta.', isError: true }
      }));
    }
  };

  const handleReconnectFolder = async () => {
    let dirHandle = savedDirHandleRef.current || savedFolderInfo?.handle;

    if (!dirHandle) {
      try {
        if (window.showDirectoryPicker) {
          dirHandle = await window.showDirectoryPicker();
          const folderName = dirHandle.name || savedFolderInfo?.name || 'Carpeta de música';
          savedDirHandleRef.current = dirHandle;
          setSavedFolderInfo({ handle: dirHandle, name: folderName });
          setHasDiskPermission(true);
          await saveDirectoryHandle(dirHandle);

          if (songs && songs.length > 0) {
            await linkFilesFromDirectoryHandle(dirHandle);
            window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
              detail: { message: `Audio conectado para "${folderName}". ¡Listo para reproducir!` }
            }));
          } else {
            await scanAndProcessDirectoryHandle(dirHandle);
          }
          return;
        } else if (fileInputRef.current) {
          fileInputRef.current.click();
          return;
        }
      } catch (pickerErr) {
        if (pickerErr.name !== 'AbortError') {
          console.warn('Error seleccionando carpeta para reconexión:', pickerErr);
        }
        return;
      }
    }

    try {
      let permission = 'granted';
      if (dirHandle.requestPermission) {
        permission = await dirHandle.requestPermission({ mode: 'read' });
      }

      if (permission === 'granted') {
        setIsScanning(true);
        setStatusMessage('Conectando con la biblioteca...');
        setHasDiskPermission(true);
        savedDirHandleRef.current = dirHandle;
        setSavedFolderInfo(prev => ({
          ...(prev || {}),
          handle: dirHandle,
          name: dirHandle.name || prev?.name || 'Carpeta de música'
        }));

        if (songs && songs.length > 0) {
          await linkFilesFromDirectoryHandle(dirHandle);
          setIsScanning(false);
          setStatusMessage('');
          window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
            detail: { message: `Audio conectado para "${savedFolderInfo?.name || dirHandle.name}". ¡Listo para reproducir!` }
          }));

          // Si aún no está clonada al almacenamiento permanente local (OPFS), clonarla en segundo plano
          if (isOPFSSupported() && !isClonedToOPFS) {
            cloneLibraryToOPFS(songs, null, cachedFileMapRef.current).then(async (res) => {
              if (res.success && res.cloned > 0) {
                setIsClonedToOPFS(true);
                setOpfsTrackCount(res.cloned);
                const est = await getStorageEstimate();
                if (est) setStorageInfo(est);
                triggerSyncCelebration('Guardado Autónomo Completado', `${res.cloned} pistas listas para sonar sin conexión ni permisos`);
                window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
                  detail: { message: `¡${res.cloned} canciones guardadas en almacenamiento local permanente! Ya no necesitarás pedir permisos.` }
                }));
              }
            });
          }
        } else {
          await scanAndProcessDirectoryHandle(dirHandle);
          setStatusMessage('');
          window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
            detail: { message: `Biblioteca "${savedFolderInfo?.name || dirHandle.name}" cargada con éxito.` }
          }));
        }
      } else {
        setIsScanning(false);
        setStatusMessage('');
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: { message: 'Permiso no otorgado. Puedes volver a intentar cuando gustes.', isError: true }
        }));
      }
    } catch (err) {
      console.warn('Error reconectando carpeta guardada:', err);
      setIsScanning(false);
      setStatusMessage('');
      try {
        if (window.showDirectoryPicker) {
          const newHandle = await window.showDirectoryPicker();
          savedDirHandleRef.current = newHandle;
          setSavedFolderInfo({ handle: newHandle, name: newHandle.name });
          setHasDiskPermission(true);
          await saveDirectoryHandle(newHandle);
          if (songs && songs.length > 0) {
            await linkFilesFromDirectoryHandle(newHandle);
          } else {
            await scanAndProcessDirectoryHandle(newHandle);
          }
        }
      } catch (e) {}
    }
  };

  const handleSyncFolder = async () => {
    let dirHandle = savedDirHandleRef.current || savedFolderInfo?.handle;

    if (!dirHandle) {
      try {
        if (window.showDirectoryPicker) {
          dirHandle = await window.showDirectoryPicker();
          const folderName = dirHandle.name || savedFolderInfo?.name || 'Carpeta de música';
          savedDirHandleRef.current = dirHandle;
          setSavedFolderInfo({ handle: dirHandle, name: folderName });
          setHasDiskPermission(true);
          await saveDirectoryHandle(dirHandle);
          await syncDirectoryHandle(dirHandle);
          return;
        } else if (fileInputRef.current) {
          fileInputRef.current.click();
          return;
        }
      } catch (pickerErr) {
        if (pickerErr.name !== 'AbortError') {
          console.warn('Error seleccionando carpeta para sincronizar:', pickerErr);
        }
        return;
      }
    }

    try {
      let permission = 'granted';
      if (dirHandle.requestPermission) {
        permission = await dirHandle.requestPermission({ mode: 'read' });
      }

      if (permission === 'granted') {
        setHasDiskPermission(true);
        savedDirHandleRef.current = dirHandle;
        setSavedFolderInfo(prev => ({
          ...(prev || {}),
          handle: dirHandle,
          name: dirHandle.name || prev?.name || 'Carpeta de música'
        }));
        await syncDirectoryHandle(dirHandle);
      } else {
        setIsScanning(false);
        setStatusMessage('');
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: { message: 'Se necesita permiso de lectura para sincronizar la carpeta.', isError: true }
        }));
      }
    } catch (err) {
      console.warn('Error sincronizando biblioteca:', err);
      setIsScanning(false);
      setStatusMessage('');
      try {
        if (window.showDirectoryPicker) {
          const newHandle = await window.showDirectoryPicker();
          savedDirHandleRef.current = newHandle;
          setSavedFolderInfo({ handle: newHandle, name: newHandle.name });
          setHasDiskPermission(true);
          await saveDirectoryHandle(newHandle);
          await syncDirectoryHandle(newHandle);
        }
      } catch (e) {}
    }
  };

  const handleCloneToStorage = async () => {
    if (!songs || songs.length === 0) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'No hay canciones cargadas en la biblioteca para clonar.', isError: true }
      }));
      return;
    }

    let dirHandle = savedDirHandleRef.current || savedFolderInfo?.handle;
    const hasAnyRaw = songs.some(s => s.rawFile || s.fileEntry) || (cachedFileMapRef.current && cachedFileMapRef.current.size > 0);

    if (!hasAnyRaw) {
      if (!dirHandle) {
        try {
          if (window.showDirectoryPicker) {
            dirHandle = await window.showDirectoryPicker();
            savedDirHandleRef.current = dirHandle;
            setSavedFolderInfo({ handle: dirHandle, name: dirHandle.name });
            await saveDirectoryHandle(dirHandle);
          }
        } catch (e) {
          return;
        }
      }

      if (dirHandle) {
        try {
          let perm = 'granted';
          if (dirHandle.requestPermission) {
            perm = await dirHandle.requestPermission({ mode: 'read' });
          }
          if (perm === 'granted') {
            await linkFilesFromDirectoryHandle(dirHandle);
          } else {
            window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
              detail: { message: 'Se requiere permiso de lectura para clonar los archivos a la memoria permanente.', isError: true }
            }));
            return;
          }
        } catch (err) {
          console.warn('Error solicitando permisos en handleCloneToStorage:', err);
          return;
        }
      }
    }

    setIsScanning(true);
    setStatusMessage('Iniciando clonación permanente a almacenamiento local (OPFS)...');
    setScanProgress(0);

    try {
      const res = await cloneLibraryToOPFS(songs, (curr, tot, name) => {
        if (curr % 5 === 0 || curr === tot) {
          setStatusMessage(`Clonando permanentemente (${curr}/${tot}): ${name}`);
          setScanProgress(Math.round((curr / tot) * 100));
        }
      }, cachedFileMapRef.current);

      if (res.success && res.cloned > 0) {
        setIsClonedToOPFS(true);
        setOpfsTrackCount(res.cloned);
        setHasDiskPermission(true);
        const est = await getStorageEstimate();
        if (est) setStorageInfo(est);
        triggerSyncCelebration('Almacenamiento Local Clonado', `${res.cloned} canciones guardadas de forma 100% autónoma`);
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: {
            message: `¡Clonación exitosa! ${res.cloned} canciones guardadas permanentemente. Ya no necesitarás pedir permisos ni abrir carpetas al iniciar.`
          }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
          detail: { message: 'No se pudieron clonar los archivos. Asegúrate de que la carpeta física esté conectada.', isError: true }
        }));
      }
    } catch (err) {
      console.error('Error en handleCloneToStorage:', err);
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Error durante la clonación.', isError: true }
      }));
    } finally {
      setIsScanning(false);
      setStatusMessage('');
    }
  };

  const handleForgetSavedFolder = async () => {
    try {
      // 1. Detener de inmediato cualquier reproducción activa y procesos secundarios
      window.dispatchEvent(new CustomEvent('musicPlayer_stop'));
      setGlobalIsPlaying(false);
      setIsIdle(false);
      closePiP();
      cancelSleepTimer();

      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        setCurrentAudioUrl(null);
      }
      setSelectedSong(null);
      setActiveSong(null);
      setPrevSong(null);
      setHighlightedSong(null);
      setPlayQueue([]);
      setBaseList(null);

      // Revocar blobs de audio y carátulas de canciones para liberar memoria
      songs.forEach(s => {
        if (s.url) {
          try { URL.revokeObjectURL(s.url); } catch (e) {}
        }
        if (s.cover && typeof s.cover === 'string' && s.cover.startsWith('blob:')) {
          try { URL.revokeObjectURL(s.cover); } catch (e) {}
        }
      });
      setSongs([]);

      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        } catch (e) {}
      }

      await clearSavedDirectoryHandle();
      await clearCachedLibrary();
      await clearOPFSTracks();
      savedDirHandleRef.current = null;
      setSavedFolderInfo(null);
      setHasDiskPermission(false);
      setIsClonedToOPFS(false);
      setOpfsTrackCount(0);
      cachedFileMapRef.current = new Map();
      try {
        localStorage.removeItem('musicPlayer_hasSavedFolder');
        localStorage.removeItem('musicPlayer_savedFolderName');
        localStorage.removeItem('musicPlayer_savedSongCount');
      } catch (e) {}
      const estimate = await getStorageEstimate();
      if (estimate) setStorageInfo(estimate);
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Biblioteca y almacenamiento permanente eliminados por completo.', icon: 'trash' }
      }));
    } catch (e) {
      console.warn('Error al borrar carpeta guardada:', e);
    }
  };

  const handleFallbackInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const firstFile = e.target.files[0];
      const folderName = (firstFile.webkitRelativePath ? firstFile.webkitRelativePath.split('/')[0] : '') || 'Carpeta de música';
      try {
        localStorage.setItem('musicPlayer_hasSavedFolder', 'true');
        localStorage.setItem('musicPlayer_savedFolderName', folderName);
      } catch (err) {}
      setSavedFolderInfo({ handle: null, name: folderName });
      processFiles(e.target.files);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const openModal = (title, items) => {
    setModalData({ title, items });
  };

  const playRoulette = () => {
    if (songs.length === 0 || rouletteSpinning) return;

    setRouletteSpinning(true);
    setRouletteResult(null);

    const randomTracks = [...songs].sort(() => 0.5 - Math.random()).slice(0, 6);

    setTimeout(() => {
      setRouletteSpinning(false);
      if (randomTracks.length > 0) {
        setRouletteResult(randomTracks[0]);
        setPlaylistTitle("Ruleta Musical");
        setBaseList(randomTracks);
        handleSelectSong(randomTracks[0], true);
      }
    }, 1500);
  };

  const getDecades = () => {
    const counts = {};
    const decadeSongs = {};
    songs.forEach(s => {
      const match = String(s.year).match(/\d{4}/);
      if (match) {
        const decade = Math.floor(parseInt(match[0]) / 10) * 10;
        const decKey = `${decade}s`;
        counts[decKey] = (counts[decKey] || 0) + 1;
        if (!decadeSongs[decKey]) decadeSongs[decKey] = [];
        decadeSongs[decKey].push(s);
      }
    });
    Object.keys(decadeSongs).forEach(k => sortAlpha(decadeSongs[k]));
    const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
    return { sorted, decadeSongs };
  };

  const getTopGenres = () => {
    const counts = {};
    const genreSongs = {};
    songs.forEach(s => {
      if (s.genre && s.genre !== 'Desconocido') {
        const genres = s.genre.split(',').map(g => normalizeText(g));
        genres.forEach(g => {
          const niceG = g.charAt(0).toUpperCase() + g.slice(1);
          counts[niceG] = (counts[niceG] || 0) + 1;
          if (!genreSongs[niceG]) genreSongs[niceG] = [];
          if (!genreSongs[niceG].find(x => x.id === s.id)) genreSongs[niceG].push(s);
        });
      }
    });
    Object.keys(genreSongs).forEach(k => sortAlpha(genreSongs[k]));
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { sorted, genreSongs };
  };

  // Conteo de pistas por artista para colecciones inteligentes
  const artistCounts = useMemo(() => {
    const map = {};
    songs.forEach(s => {
      if (s.artist && s.artist !== 'Desconocido') {
        map[s.artist] = (map[s.artist] || 0) + 1;
      }
    });
    return map;
  }, [songs]);

  // Colecciones dinámicas predefinidas
  const builtInSmartPlaylists = useMemo(() => {
    return [
      {
        id: 'favorites',
        name: 'Favoritas',
        category: 'habits',
        icon: Heart,
        desc: 'Tus temas destacados marcados con corazón ❤️',
        badgeColor: '#f43f5e',
        filter: (s) => isSongFavorite(s)
      },
      {
        id: 'heavy-rotation',
        name: 'En Alta Rotación',
        category: 'habits',
        icon: Zap,
        desc: 'Tus canciones más reproducidas en la aplicación',
        badgeColor: '#eab308',
        filter: (s) => getSongPlayCount(s) > 0,
        sort: (a, b) => getSongPlayCount(b) - getSongPlayCount(a),
        limit: 40
      },
      {
        id: 'forgotten-gems',
        name: 'Joyas Olvidadas',
        category: 'habits',
        icon: Sparkles,
        desc: 'Canciones en tu biblioteca que aún no has reproducido',
        badgeColor: '#8b5cf6',
        filter: (s) => getSongPlayCount(s) === 0,
        limit: 50
      },
      {
        id: 'audiophile-hifi',
        name: 'Audiófilo Hi-Fi',
        category: 'audio',
        icon: Waves,
        desc: 'Audio de alta fidelidad: ≥ 320 kbps o sin pérdida (FLAC/WAV)',
        badgeColor: '#06b6d4',
        filter: (s) => {
          const br = parseInt(String(s.bitrate).replace(/\D/g, '')) || 0;
          const isLossless = /flac|wav|alac|aiff/i.test(s.codec || s.filename);
          return br >= 320 || isLossless;
        }
      },
      {
        id: 'decade-80s',
        name: 'Cápsula de los 80s',
        category: 'decades',
        icon: Disc,
        desc: 'Grandes clásicos y sintetizadores de 1980 a 1989',
        badgeColor: '#ec4899',
        filter: (s) => {
          const yr = parseInt(String(s.year).match(/\d{4}/)?.[0]);
          return yr >= 1980 && yr <= 1989;
        }
      },
      {
        id: 'decade-90s',
        name: 'Nostalgia de los 90s',
        category: 'decades',
        icon: Radio,
        desc: 'El sonido inconfundible y alternativo de 1990 a 1999',
        badgeColor: '#3b82f6',
        filter: (s) => {
          const yr = parseInt(String(s.year).match(/\d{4}/)?.[0]);
          return yr >= 1990 && yr <= 1999;
        }
      },
      {
        id: 'decade-2000s',
        name: 'Éxitos de los 2000s',
        category: 'decades',
        icon: Disc3,
        desc: 'La explosión pop y rock del nuevo milenio (2000-2009)',
        badgeColor: '#10b981',
        filter: (s) => {
          const yr = parseInt(String(s.year).match(/\d{4}/)?.[0]);
          return yr >= 2000 && yr <= 2009;
        }
      },
      {
        id: 'decade-modern',
        name: 'Era Contemporánea (2010+)',
        category: 'decades',
        icon: Activity,
        desc: 'Lanzamientos y producciones desde 2010 en adelante',
        badgeColor: '#f97316',
        filter: (s) => {
          const yr = parseInt(String(s.year).match(/\d{4}/)?.[0]);
          return yr >= 2010;
        }
      },
      {
        id: 'prolific-artists',
        name: 'Artistas Prolíficos',
        category: 'catalog',
        icon: Mic2,
        desc: 'Pistas de creadores con 3 o más temas en tu colección',
        badgeColor: '#a855f7',
        filter: (s) => (artistCounts[s.artist] || 0) >= 3
      },
      {
        id: 'quick-tracks',
        name: 'Pistas Rápidas (< 2:30)',
        category: 'duration',
        icon: Clock,
        desc: 'Temas concentrados, directos y de alta energía',
        badgeColor: '#14b8a6',
        filter: (s) => s.duration > 0 && s.duration <= 150
      },
      {
        id: 'epic-journeys',
        name: 'Viajes Épicos (> 5:00)',
        category: 'duration',
        icon: Compass,
        desc: 'Composiciones extensas, progresivas y cinemáticas',
        badgeColor: '#6366f1',
        filter: (s) => s.duration >= 300
      }
    ];
  }, [songs, favorites, playCounts, artistCounts]);

  const evaluateCustomRule = (song, rule) => {
    let songVal = song[rule.field];
    if (rule.field === 'isFavorite') songVal = isSongFavorite(song);
    if (rule.field === 'playCount') songVal = getSongPlayCount(song);
    if (rule.field === 'bitrate') songVal = parseInt(String(song.bitrate).replace(/\D/g, '')) || 0;
    if (rule.field === 'year') songVal = parseInt(String(song.year).match(/\d{4}/)?.[0]) || 0;
    if (rule.field === 'duration') songVal = song.duration || 0;

    const targetVal = rule.value;

    switch (rule.operator) {
      case 'contains':
        return normalizeText(String(songVal || '')).includes(normalizeText(String(targetVal || '')));
      case 'equals':
        return normalizeText(String(songVal || '')) === normalizeText(String(targetVal || ''));
      case 'greaterThan':
        return Number(songVal) >= Number(targetVal);
      case 'lessThan':
        return Number(songVal) <= Number(targetVal);
      case 'isTrue':
        return Boolean(songVal);
      case 'isFalse':
        return !Boolean(songVal);
      default:
        return true;
    }
  };

  const getPlaylistSongs = (playlist) => {
    if (!songs || songs.length === 0 || !playlist) return [];

    let matched = [];
    if (playlist.filter) {
      matched = songs.filter(playlist.filter);
    } else if (playlist.rules && playlist.rules.length > 0) {
      const matchType = playlist.matchType || 'all';
      matched = songs.filter(song => {
        if (matchType === 'all') {
          return playlist.rules.every(r => evaluateCustomRule(song, r));
        } else {
          return playlist.rules.some(r => evaluateCustomRule(song, r));
        }
      });
    } else {
      matched = [...songs];
    }

    if (playlist.sort) {
      if (typeof playlist.sort === 'function') {
        matched.sort(playlist.sort);
      } else if (playlist.sort === 'mostPlayed') {
        matched.sort((a, b) => getSongPlayCount(b) - getSongPlayCount(a));
      } else if (playlist.sort === 'yearDesc') {
        matched.sort((a, b) => (parseInt(String(b.year).match(/\d{4}/)?.[0]) || 0) - (parseInt(String(a.year).match(/\d{4}/)?.[0]) || 0));
      } else if (playlist.sort === 'titleAsc') {
        matched.sort((a, b) => normalizeText(a.title).localeCompare(normalizeText(b.title)));
      } else if (playlist.sort === 'random') {
        matched = [...matched].sort(() => Math.random() - 0.5);
      }
    }

    if (playlist.limit && playlist.limit > 0) {
      matched = matched.slice(0, playlist.limit);
    }

    return matched;
  };

  const allSmartPlaylists = useMemo(() => {
    return [...builtInSmartPlaylists, ...customSmartPlaylists];
  }, [builtInSmartPlaylists, customSmartPlaylists]);

  const displaySmartPlaylists = useMemo(() => {
    if (smartFilterTab === 'all') return allSmartPlaylists;
    if (smartFilterTab === 'custom') return customSmartPlaylists;
    return allSmartPlaylists.filter(p => p.category === smartFilterTab);
  }, [allSmartPlaylists, customSmartPlaylists, smartFilterTab]);

  const handleOpenSmartPlaylist = (playlist, playImmediately = false) => {
    const list = getPlaylistSongs(playlist);
    if (list.length === 0) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: `La lista "${playlist.name}" no tiene canciones que coincidan actualmente.` }
      }));
      return;
    }
    setPlaylistTitle(`✦ ${playlist.name}`);
    setBaseList(list);
    setActiveTab('library');
    if (playImmediately && list.length > 0) {
      handleSelectSong(list[0], true);
    }
  };

  const handleSaveCustomPlaylist = () => {
    if (!editingSmartPlaylist || !editingSmartPlaylist.name.trim()) {
      window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
        detail: { message: 'Por favor ingresa un nombre para la lista dinámica.', isError: true }
      }));
      return;
    }

    setCustomSmartPlaylists(prev => {
      const exists = prev.some(p => p.id === editingSmartPlaylist.id);
      let updated;
      if (exists) {
        updated = prev.map(p => p.id === editingSmartPlaylist.id ? { ...editingSmartPlaylist, isCustom: true } : p);
      } else {
        updated = [...prev, { ...editingSmartPlaylist, isCustom: true }];
      }
      try {
        localStorage.setItem('musicPlayer_smartPlaylists', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    setShowSmartBuilderModal(false);
    setEditingSmartPlaylist(null);
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: `Lista dinámica "${editingSmartPlaylist.name}" guardada con éxito.` }
    }));
  };

  const handleDeleteCustomPlaylist = (id) => {
    setCustomSmartPlaylists(prev => {
      const updated = prev.filter(p => p.id !== id);
      try {
        localStorage.setItem('musicPlayer_smartPlaylists', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: 'Lista dinámica eliminada.' }
    }));
  };

  const getStats = () => {
    if (songs.length === 0) return null;

    const artists = {};
    const albums = {};
    const years = {};
    let bracketsCount = 0;
    const initialLetters = {};
    let upperCaseTitles = 0;

    let longestTitle = songs[0];
    let shortestTitle = songs[0];
    let mostDiverseChars = songs[0];
    let leastDiverseChars = null;
    let longestDuration = songs[0];
    let shortestDuration = songs[0];
    let highestBitrate = songs[0];
    let lowestBitrate = songs[0];
    let loudestSong = songs[0];
    let quietestSong = songs[0];

    const getUniqueChars = (str) => new Set(String(str).toLowerCase().replace(/[^a-z0-9áéíóúüñ]/g, '')).size;
    const parseBitrate = (str) => parseInt(String(str).replace(/\D/g, '')) || 0;

    songs.forEach(s => {
      if (s.artist !== 'Desconocido') artists[s.artist] = (artists[s.artist] || 0) + 1;
      if (s.album !== 'Desconocido') albums[s.album] = (albums[s.album] || 0) + 1;

      const yr = parseInt(String(s.year).match(/\d{4}/)?.[0]);
      if (!isNaN(yr)) years[yr] = (years[yr] || 0) + 1;

      if (s.title && (s.title.includes('(') || s.title.includes('['))) bracketsCount++;

      const letter = normalizeText(s.title).charAt(0);
      if (letter && letter.match(/[a-z]/)) initialLetters[letter] = (initialLetters[letter] || 0) + 1;

      if (s.title && s.title === s.title.toUpperCase() && s.title.match(/[A-Z]/)) upperCaseTitles++;

      if (s.title && s.title.length > (longestTitle.title?.length || 0)) longestTitle = s;
      if (s.title && s.title.length > 0 && s.title.length < (shortestTitle.title?.length || 999)) shortestTitle = s;

      const uniqueC = getUniqueChars(s.title);
      if (uniqueC > getUniqueChars(mostDiverseChars.title)) mostDiverseChars = s;
      if (uniqueC > 0 && (!leastDiverseChars || uniqueC < getUniqueChars(leastDiverseChars.title))) leastDiverseChars = s;

      if (s.duration && s.duration > 0) {
        if (!longestDuration.duration || s.duration > longestDuration.duration) longestDuration = s;
        if (!shortestDuration.duration || shortestDuration.duration === 0 || s.duration < shortestDuration.duration) shortestDuration = s;
      }



      const br = parseBitrate(s.bitrate);
      if (br > 0) {
        if (br > parseBitrate(highestBitrate.bitrate)) highestBitrate = s;
        if (parseBitrate(lowestBitrate.bitrate) === 0 || br < parseBitrate(lowestBitrate.bitrate)) lowestBitrate = s;
      }
    });

    if (!leastDiverseChars) leastDiverseChars = songs[0];

    const topArtistName = Object.entries(artists).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topAlbumName = Object.entries(albums).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topYearName = Object.entries(years).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topLetterVal = Object.entries(initialLetters).sort((a, b) => b[1] - a[1])[0];
    const topLetter = topLetterVal ? topLetterVal[0].toUpperCase() : 'N/A';

    const validYears = songs.map(s => parseInt(String(s.year).match(/\d{4}/)?.[0])).filter(y => !isNaN(y));
    const oldest = validYears.length ? Math.min(...validYears) : 'N/A';
    const newest = validYears.length ? Math.max(...validYears) : 'N/A';
    const timelineData = Object.entries(years).map(([y, c]) => ({ year: parseInt(y), count: c })).sort((a, b) => a.year - b.year);
    const uniqueGenres = new Set(songs.map(s => normalizeText(s.genre)).filter(g => g && g !== 'desconocido')).size;

    const prolificArtists = new Set(Object.entries(artists).filter(x => x[1] > 1).map(x => x[0]));
    const fugacesArtists = new Set(Object.entries(artists).filter(x => x[1] === 1).map(x => x[0]));

    const topArtistSongs = sortAlpha(songs.filter(s => s.artist === topArtistName));
    const topAlbumSongs = sortAlpha(songs.filter(s => s.album === topAlbumName));
    const topYearSongs = sortAlpha(songs.filter(s => String(s.year).includes(topYearName)));
    const oldestSongs = sortAlpha(songs.filter(s => String(s.year).includes(String(oldest))));
    const newestSongs = sortAlpha(songs.filter(s => String(s.year).includes(String(newest))));
    const prolificSongs = sortAlpha(songs.filter(s => prolificArtists.has(s.artist)));
    const fugacesSongs = sortAlpha(songs.filter(s => fugacesArtists.has(s.artist)));
    const oneWordSongs = sortAlpha(songs.filter(s => s.title && s.title.trim().split(' ').length === 1));
    const upperCaseSongs = sortAlpha(songs.filter(s => s.title && s.title === s.title.toUpperCase() && s.title.match(/[A-Z]/)));
    const bracketsSongs = sortAlpha(songs.filter(s => s.title && (s.title.includes('(') || s.title.includes('['))));
    const topLetterSongs = sortAlpha(songs.filter(s => normalizeText(s.title).charAt(0).toUpperCase() === topLetter));

    const nonSquareSongs = sortAlpha(songs.filter(s => s.cover && s.isSquareCover === false));

    const avgWords = (songs.reduce((acc, s) => acc + (s.title ? s.title.trim().split(' ').length : 0), 0) / songs.length).toFixed(1);

    return {
      topArtistName, topArtistCount: topArtistSongs.length, topArtistSongs,
      topAlbumName, topAlbumCount: topAlbumSongs.length, topAlbumSongs,
      topYearName, topYearPercent: topYearSongs.length ? ((topYearSongs.length / songs.length) * 100).toFixed(1) : 0, topYearSongs,
      oldest, newest, oldestSongs, newestSongs, uniqueGenres, timelineData,
      prolificCount: prolificArtists.size, prolificSongs,
      fugacesCount: fugacesArtists.size, fugacesSongs,
      bracketsCount, bracketsPercent: ((bracketsCount / songs.length) * 100).toFixed(1), bracketsSongs,
      topLetter, topLetterSongs,
      upperCaseTitles, upperCaseSongs,
      longestTitleName: longestTitle.title || 'N/A', longestTitleLength: longestTitle.title ? longestTitle.title.length : 0, longestTitleObj: longestTitle,
      shortestTitleName: shortestTitle.title || 'N/A', shortestTitleLength: shortestTitle.title ? shortestTitle.title.length : 0, shortestTitleObj: shortestTitle,
      mostDiverseCharsName: mostDiverseChars.title || 'N/A', mostDiverseCharsCount: getUniqueChars(mostDiverseChars.title), mostDiverseCharsObj: mostDiverseChars,
      leastDiverseCharsName: leastDiverseChars.title || 'N/A', leastDiverseCharsCount: getUniqueChars(leastDiverseChars.title), leastDiverseCharsObj: leastDiverseChars,
      longestDurationObj: longestDuration, shortestDurationObj: shortestDuration,
      highestBitrateObj: highestBitrate, lowestBitrateObj: lowestBitrate,
      loudestSongObj: loudestSong, quietestSongObj: quietestSong,
      oneWordTitles: oneWordSongs.length, oneWordSongs, avgWords,
      nonSquareSongs
    };
  };

  const exportToMarkdown = () => {
    if (songs.length === 0) return;

    const s = getStats();
    const decades = getDecades();
    const genres = getTopGenres();

    const escapeMD = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/\|/g, '\\|')
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };

    const formatList = (arr) => {
      if (!arr || arr.length === 0) return '    - *(Sin pistas)*\n';
      return arr.map(x => `    - ${escapeMD(x.title)} - ${escapeMD(x.artist)} (${escapeMD(x.year)})`).join('\n') + '\n';
    };

    let md = `# Reporte Analítico Integral de Biblioteca Musical\n\n`;
    md += `Fecha de generación: ${new Date().toLocaleDateString()}\n\n`;

    md += `## 1. Resumen General\n`;
    md += `- **Canciones Escaneadas:** ${songs.length}\n`;

    md += `- **Compositor Principal:** ${escapeMD(s.topArtistName)} (${s.topArtistCount} pistas)\n`;
    md += formatList(s.topArtistSongs);

    md += `- **Álbum Más Poblado:** ${escapeMD(s.topAlbumName)} (${s.topAlbumCount} pistas)\n`;
    md += formatList(s.topAlbumSongs);
    md += `\n`;

    md += `## 2. Cronología\n`;
    md += `- **Año más antiguo (Vintage):** ${escapeMD(s.oldest)}\n`;
    md += formatList(s.oldestSongs);
    md += `- **Año más moderno:** ${escapeMD(s.newest)}\n`;
    md += formatList(s.newestSongs);

    md += `- **Monopolio Anual:** El año ${escapeMD(s.topYearName)} domina con el ${s.topYearPercent}% de la biblioteca.\n`;
    md += formatList(s.topYearSongs);

    md += `- **Distribución por Década:**\n`;
    decades.sorted.forEach(d => {
      md += `  - **${escapeMD(d[0])}** (${d[1]} pistas)\n`;
      md += formatList(decades.decadeSongs[d[0]]);
    });
    md += `\n`;

    md += `## 3. Diversidad y Géneros\n`;
    md += `- **Géneros Únicos Descubiertos:** ${s.uniqueGenres}\n`;
    md += `- **Top 5 Géneros Dominantes:**\n`;
    genres.sorted.forEach(g => {
      md += `  - **${escapeMD(g[0])}** (${g[1]} pistas)\n`;
      md += formatList(genres.genreSongs[g[0]]);
    });
    md += `\n`;

    md += `## 4. Métricas Especiales y Curiosidades\n`;
    md += `- **Artistas Prolíficos (>1 pista):** ${s.prolificCount} artistas\n`;
    md += formatList(s.prolificSongs);

    md += `- **One-Hit Wonders (1 pista):** ${s.fugacesCount} artistas\n`;
    md += formatList(s.fugacesSongs);

    md += `- **Longitud de Caracteres Máxima:** "${escapeMD(s.longestTitleName)}" con ${s.longestTitleLength} letras.\n`;
    md += formatList([s.longestTitleObj]);

    md += `- **Minimalismo:** ${s.oneWordTitles.length} canciones tienen títulos de exactamente 1 palabra.\n`;
    md += formatList(s.oneWordSongs);

    md += `- **Frecuencia Alfabética:** La letra más común para iniciar títulos es la "${escapeMD(s.topLetter)}".\n`;
    md += formatList(s.topLetterSongs);

    md += `- **Títulos Gritones (MAYÚSCULAS):** ${s.upperCaseTitles} pistas.\n`;
    md += formatList(s.upperCaseSongs);

    md += `- **Títulos Complejos (Remixes/En Vivo):** El ${s.bracketsPercent}% de la biblioteca.\n`;
    md += formatList(s.bracketsSongs);

    md += `- **Portadas Asimétricas (No 1:1):** ${s.nonSquareSongs.length} pistas tienen arte de tapa rectangular.\n`;
    md += formatList(s.nonSquareSongs);

    md += `- **Promedio de Palabras por Título:** ${s.avgWords} palabras.\n\n`;

    md += `---\n\n`;
    md += `## Catálogo Completo\n\n`;
    md += `| Título | Artista | Álbum | Género | Año |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;

    const exportSongs = sortAlpha([...songs]);
    exportSongs.forEach(song => {
      md += `| ${escapeMD(song.title)} | ${escapeMD(song.artist)} | ${escapeMD(song.album)} | ${escapeMD(song.genre)} | ${escapeMD(song.year)} |\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Inteligencia_Musical.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  const wipeLibrary = async () => {
    window.dispatchEvent(new CustomEvent('musicPlayer_stop'));
    setGlobalIsPlaying(false);
    setIsIdle(false);
    closePiP();
    cancelSleepTimer();

    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioUrl(null);
    }
    setSelectedSong(null);
    setActiveSong(null);
    setPrevSong(null);
    setHighlightedSong(null);
    setPlayQueue([]);
    setBaseList(null);

    songs.forEach(s => {
      if (s.url) {
        try { URL.revokeObjectURL(s.url); } catch (e) {}
      }
      if (s.cover && typeof s.cover === 'string' && s.cover.startsWith('blob:')) {
        try { URL.revokeObjectURL(s.cover); } catch (e) {}
      }
    });
    setSongs([]);

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      } catch (e) {}
    }

    setActiveTab('library');
    setSearchQuery('');
    setSavedFolderInfo(null);
    setHasDiskPermission(false);
    setIsClonedToOPFS(false);
    setOpfsTrackCount(0);
    cachedFileMapRef.current = new Map();
    await clearSavedDirectoryHandle();
    await clearCachedLibrary();
    await clearOPFSTracks();
    const estimate = await getStorageEstimate();
    if (estimate) setStorageInfo(estimate);
    window.dispatchEvent(new CustomEvent('musicPlayer_appToast', {
      detail: { message: 'Biblioteca y almacenamiento permanente eliminados por completo.' }
    }));
  };

  const stats = getStats();
  const decadesData = getDecades();
  const genresData = getTopGenres();

  const zenPlaybackRefs = useMemo(() => ({
    bar: zenProgressBarRef,
    screen: zenScreenBarRef,
    ring: zenRingRef,
    time: zenTimeRef
  }), []);

  const zenVisualConfig = useMemo(() => ({
    mode: zenVisualMode,
    opacity: zenVisualOpacity,
    coverPulse: zenCoverPulse,
    blur: zenBlurIntensity,
    showDetails: zenShowDetails,
    highPerf: highPerfGPU,
    progressTiming: zenProgressTiming
  }), [zenVisualMode, zenVisualOpacity, zenCoverPulse, zenBlurIntensity, zenShowDetails, highPerfGPU, zenProgressTiming]);

  const handleTimeProgress = useCallback((data) => {
    if (pipActive && pipWindow) {
      setPipProgressData(data);
    }
  }, [pipActive, pipWindow]);

  return (
    <div className="app-container">
      {/* Animación y overlay holográfico de Sistema Robusto y Actualizado */}
      {syncCelebration && (
        <div className="system-celebration-overlay" key={syncCelebration.title}>
          <div className="system-celebration-vignette" />
          <div className="system-celebration-beam" />
          <div className="system-celebration-card">
            <div className="system-celebration-icon-box">
              <span className="sonar-ring sonar-ring-1" />
              <span className="sonar-ring sonar-ring-2" />
              <CheckCircle2 size={19} color="#10b981" />
            </div>
            <div className="system-celebration-texts">
              <div className="system-celebration-title">
                {syncCelebration.title}
              </div>
              <div className="system-celebration-sub">
                {syncCelebration.subtitle}
              </div>
            </div>
          </div>
        </div>
      )}

      <input type="file" webkitdirectory="true" directory="true" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFallbackInput} />
      <div className="top-bar">
        <div
          className="brand"
          onClick={() => {
            if (easterEggsEnabled) {
              setLogoClicks(prev => {
                const next = prev + 1;
                if (next === 5) {
                  setEggMessage("No, no voy a cambiarle el nombre.");
                  setTimeout(() => setEggMessage(''), 4000);
                  return 0;
                }
                return next;
              });
            }
          }}
          style={{ userSelect: 'none' }}
        >
          <Music size={14} color="var(--accent-color)" />
          {eggMessage || 'Reproductor de música'}
        </div>

        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)', margin: '0 8px' }}></div>

        <div style={{ display: 'flex', gap: '4px' }}>
          <div className={`top-nav-icon ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')} title="Biblioteca">
            <ListMusic size={16} />
          </div>
          <div className={`top-nav-icon ${activeTab === 'playlists' ? 'active' : ''}`} onClick={() => setActiveTab('playlists')} title="Listas Dinámicas Inteligentes">
            <Sparkles size={16} />
          </div>
          <div className={`top-nav-icon ${activeTab === 'explore' ? 'active' : ''}`} onClick={() => { setActiveTab('explore'); setExploreView('home'); }} title="Navegador Clásico">
            <Compass size={16} />
          </div>
          <div className={`top-nav-icon ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')} title="Inteligencia Analítica">
            <BarChart2 size={16} />
          </div>
          <div className={`top-nav-icon ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} title="Configuración">
            <Settings size={16} />
          </div>
        </div>

        <div className="flex-spacer"></div>

        {songs.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {savedFolderInfo && (
              <div
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 10px',
                  height: '28px',
                  boxSizing: 'border-box',
                  backgroundColor: isScanning ? 'color-mix(in srgb, var(--accent-color) 12%, var(--bg-tertiary))' : 'var(--bg-tertiary)',
                  borderRadius: '14px',
                  border: isScanning ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
                  fontSize: '11px',
                  transition: 'all 0.2s ease',
                  boxShadow: isScanning ? '0 0 10px color-mix(in srgb, var(--accent-color) 25%, transparent)' : 'none',
                  userSelect: 'none'
                }}
              >
                {/* Mini barra de progreso fija en el borde inferior durante escaneo o sincronización */}
                {isScanning && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      height: '2px',
                      width: `${scanProgress}%`,
                      backgroundColor: 'var(--accent-color)',
                      boxShadow: '0 0 5px var(--accent-color)',
                      transition: 'width 0.2s ease',
                      zIndex: 2
                    }}
                  />
                )}

                {isScanning ? (
                  // ESTADO EN PROCESO COMPACTO: solo símbolo rotatorio de trabajo y progresión numérica
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <RotateCcw size={12} className="spin" style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: '10.5px',
                        color: 'var(--accent-color)',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1
                      }}
                    >
                      Sincronizando {scanProgress}%
                    </span>
                  </div>
                ) : (
                  // ESTADO EN REPOSO COMPACTO: Estados claros (Local / Conectado / Pendiente) sin desalineaciones
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      onClick={() => {
                        setActiveTab('settings');
                        setSettingsCategory('system');
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer'
                      }}
                      title={`${savedFolderInfo.name} • Clic para ver en Configuración > Sistema`}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          display: 'inline-block',
                          backgroundColor: isClonedToOPFS ? '#10b981' : (hasDiskPermission ? '#06b6d4' : '#f59e0b'),
                          boxShadow: isClonedToOPFS
                            ? '0 0 6px rgba(16,185,129,0.6)'
                            : (hasDiskPermission ? '0 0 6px rgba(6,182,212,0.6)' : '0 0 6px rgba(245,158,11,0.6)'),
                          flexShrink: 0
                        }}
                        title={
                          isClonedToOPFS
                            ? `Estado: Local permanente • ${opfsTrackCount} pistas listas sin permisos`
                            : (hasDiskPermission ? 'Estado: Carpeta conectada' : 'Estado: Permiso pendiente de lectura')
                        }
                      />
                      <span
                        style={{
                          color: 'var(--text-secondary)',
                          maxWidth: '90px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 500,
                          fontSize: '11px',
                          lineHeight: '14px'
                        }}
                      >
                        {savedFolderInfo.name}
                      </span>

                      <span
                        style={{
                          fontSize: '9px',
                          padding: '1.5px 5px',
                          borderRadius: '4px',
                          backgroundColor: isClonedToOPFS
                            ? 'rgba(16, 185, 129, 0.14)'
                            : (hasDiskPermission ? 'rgba(6, 182, 212, 0.14)' : 'rgba(245, 158, 11, 0.14)'),
                          color: isClonedToOPFS ? '#10b981' : (hasDiskPermission ? '#06b6d4' : '#f59e0b'),
                          fontWeight: 700,
                          letterSpacing: '0.2px',
                          flexShrink: 0,
                          userSelect: 'none',
                          lineHeight: 1
                        }}
                        title={
                          isClonedToOPFS
                            ? 'Música almacenada localmente en la app'
                            : (hasDiskPermission ? 'Carpeta autorizada en disco' : 'Requiere conceder permisos')
                        }
                      >
                        {isClonedToOPFS ? 'Local' : (hasDiskPermission ? 'Conectado' : 'Pendiente')}
                      </span>
                    </div>

                    {!isClonedToOPFS && (
                      <>
                        {/* Divisor sutil */}
                        <span style={{ width: '1px', height: '11px', backgroundColor: 'var(--border-color)', opacity: 0.8, flexShrink: 0 }} />
                        <button
                          onClick={handleCloneToStorage}
                          disabled={isScanning}
                          style={{
                            border: 'none',
                            padding: '2px 7px',
                            fontSize: '10.5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            height: '20px',
                            flexShrink: 0,
                            backgroundColor: 'var(--accent-color)',
                            color: '#fff',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            lineHeight: 1,
                            fontWeight: 500,
                            transition: 'all 0.15s ease'
                          }}
                          title="Guardar música en almacenamiento local permanente para nunca volver a pedir permisos"
                        >
                          <Zap size={10} /> Guardar
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="main-content">
        <canvas
          ref={largeCanvasRef}
          className={`large-spectrum ${largeSpectrumHeight}`}
          style={{
            display: largeSpectrumEnabled ? 'block' : 'none',
            opacity: activeTab === 'library' ? 1 : 0.3
          }}
        />

        <div className="content-area">
          {songs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', gap: '16px', padding: '20px' }}>
              <FolderOpen size={44} opacity={0.4} color="var(--accent-color)" />
              <p style={{ fontSize: '13px', maxWidth: '380px', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                Selecciona la carpeta local donde guardas tus archivos de música para comenzar.
              </p>

              {savedFolderInfo && !isScanning && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '16px 20px',
                  background: 'color-mix(in srgb, var(--accent-color) 8%, var(--bg-secondary))',
                  border: '1px solid color-mix(in srgb, var(--accent-color) 30%, transparent)',
                  borderRadius: '10px',
                  maxWidth: '380px',
                  width: '100%',
                  backdropFilter: 'blur(16px)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.35)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-color)', fontSize: '13px', fontWeight: 600 }}>
                    <RotateCcw size={15} />
                    <span>Biblioteca Anterior Detectada</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Carpeta: <strong style={{ color: 'var(--text-highlight)' }}>"{savedFolderInfo.name}"</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '4px' }}>
                    <button
                      className="btn"
                      onClick={handleReconnectFolder}
                      style={{ flex: 1, padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <Play size={13} /> Reanudar en 1 Clic
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={handleForgetSavedFolder}
                      title="Olvidar carpeta guardada"
                      style={{ padding: '8px 12px', fontSize: '12px', opacity: 0.7 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}

              <button className={savedFolderInfo ? "btn btn-outline" : "btn"} onClick={handleSelectFolder} disabled={isScanning}>
                {isScanning ? 'Procesando...' : (savedFolderInfo ? 'Seleccionar Otra Carpeta' : 'Escanear Carpeta')}
              </button>

              {isScanning && (
                <div className="progress-container">
                  <div className="progress-fill" style={{ width: `${scanProgress}%` }}></div>
                </div>
              )}
              {statusMessage && <div style={{ color: 'var(--accent-color)', fontSize: '12px' }}>{statusMessage}</div>}
              {errorMessage && <div style={{ color: '#ff5555', fontSize: '12px', border: '1px solid #662222', padding: '8px', borderRadius: '4px' }}>{errorMessage}</div>}
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-highlight)', margin: 0 }}>
                    {activeTab === 'library' ? playlistTitle : activeTab === 'playlists' ? 'Listas Dinámicas Inteligentes' : activeTab === 'dashboard' ? 'Dashboard' : activeTab === 'explore' ? 'Navegador' : 'Configuración'}
                  </h2>
                  {activeTab === 'library' && baseList && (
                    <button
                      onClick={() => { setBaseList(null); setPlaylistTitle('Biblioteca General'); }}
                      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', transition: 'background 0.2s' }}
                      title="Volver a mostrar todas las canciones de la biblioteca"
                      onMouseEnter={e => e.target.style.background = 'var(--border-color)'}
                      onMouseLeave={e => e.target.style.background = 'var(--bg-tertiary)'}
                    >
                      <X size={12} /> Ver biblioteca completa ({songs.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="library-layout" style={{ display: activeTab === 'library' ? 'flex' : 'none' }}>
                <div className="table-area">
                  <div className="toolbar">
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <Search size={14} color="var(--text-secondary)" style={{ position: 'absolute', left: '10px' }} />
                      <input
                        ref={searchInputRef}
                        type="text" className="search-input"
                        placeholder={easterEggsEnabled && searchQuery.toLowerCase() === 'fino' ? 'Todo está quedando muy fino...' : "Búsqueda..."}
                        style={{
                          paddingLeft: '32px', paddingRight: searchQuery ? '32px' : '56px',
                          borderColor: easterEggsEnabled && searchQuery.toLowerCase() === 'fino' ? '#f59e0b' : undefined,
                          color: easterEggsEnabled && searchQuery.toLowerCase() === 'fino' ? '#f59e0b' : undefined
                        }}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          const clearHotkey = hotkeys.clearSearch || 'Escape';
                          const mods = [];
                          if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
                          if (e.altKey) mods.push('Alt');
                          if (e.shiftKey) mods.push('Shift');
                          const keyName = e.code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
                          const keyStr = [...mods, keyName].join('+');

                          if (keyStr === clearHotkey || e.key === clearHotkey || (clearHotkey === 'Escape' && e.key === 'Escape')) {
                            e.preventDefault();
                            if (searchQuery) {
                              setSearchQuery('');
                            } else {
                              e.target.blur();
                            }
                          }
                        }}
                      />
                      {!searchQuery ? (
                        <div
                          style={{
                            position: 'absolute',
                            right: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px',
                            pointerEvents: 'none',
                            opacity: 0.45,
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            color: 'var(--text-secondary)'
                          }}
                          title={`Presiona ${hotkeys.search || 'Ctrl+K'} para buscar`}
                        >
                          <span>{hotkeys.search || 'Ctrl+K'}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '4px',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px',
                            borderRadius: '50%'
                          }}
                          title="Limpiar búsqueda (Esc)"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Filtros Rápidos (Chips de un clic) */}
                    <div className="filter-chips-container">
                      <button
                        type="button"
                        className={`filter-chip ${libraryFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setLibraryFilter('all')}
                        title="Mostrar todas las pistas"
                      >
                        <span>Todas</span>
                        <span className="chip-count">{songs.length}</span>
                      </button>

                      <button
                        type="button"
                        className={`filter-chip ${libraryFilter === 'favorites' ? 'active' : ''}`}
                        onClick={() => setLibraryFilter(libraryFilter === 'favorites' ? 'all' : 'favorites')}
                        title="Solo pistas marcadas como favoritas"
                      >
                        <Heart
                          size={12}
                          fill={libraryFilter === 'favorites' ? '#f43f5e' : 'none'}
                          color={libraryFilter === 'favorites' ? '#f43f5e' : 'currentColor'}
                        />
                        <span>Favoritas</span>
                        <span className="chip-count">{favoritesCount}</span>
                      </button>

                      <button
                        type="button"
                        className={`filter-chip ${libraryFilter === 'recent' ? 'active' : ''}`}
                        onClick={() => setLibraryFilter(libraryFilter === 'recent' ? 'all' : 'recent')}
                        title="Pistas añadidas recientemente"
                      >
                        <Sparkles size={12} />
                        <span>Recién añadidas</span>
                        <span className="chip-count">{recentCount}</span>
                      </button>

                      <button
                        type="button"
                        className={`filter-chip ${libraryFilter === 'discoveries' ? 'active' : ''}`}
                        onClick={() => setLibraryFilter(libraryFilter === 'discoveries' ? 'all' : 'discoveries')}
                        title="Descubrimientos (Pistas aún sin reproducir)"
                      >
                        <Compass size={12} />
                        <span>Descubrimientos</span>
                        <span className="chip-count">{discoveriesCount}</span>
                      </button>

                      {(selectedSong || activeSong) && (
                        <button
                          type="button"
                          className="filter-chip locate-track-chip"
                          onClick={() => scrollToCurrentTrack(true)}
                          title="Ir y centrar la canción en reproducción en la lista"
                          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}
                        >
                          <Disc3 size={12} className="spin-slow" color="var(--accent-color)" />
                          <span style={{ color: 'var(--accent-color)' }}>Ir a la actual</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="table-container" ref={tableContainerRef}>
                    <table className="smart-table">
                      <thead>
                        <tr>
                          {['title', 'artist', 'album', 'genre', 'year'].map(key => (
                            <th key={key} onClick={() => handleSort(key)}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {key === 'title' ? 'Pista' : key === 'artist' ? 'Artista' : key === 'album' ? 'Álbum' : key === 'genre' ? 'Género' : 'Año'}
                                <ArrowUpDown size={12} opacity={sortConfig.key === key ? 1 : 0.3} color={sortConfig.key === key ? 'var(--accent-color)' : 'currentColor'} />
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {displaySongs.map((song) => (
                          <tr
                            key={song.id}
                            id={`song-row-${song.id}`}
                            data-song-id={song.id}
                            data-song-key={getSongKey(song)}
                            className={`${highlightedSong?.id === song.id ? 'selected' : ''} ${isCurrentSong(song) ? 'now-playing' : ''}`}
                            onClick={() => {
                              setHighlightedSong(song);
                            }}
                            onDoubleClick={() => {
                              setHighlightedSong(song);
                              handleSelectSong(song);
                            }}
                            onContextMenu={(e) => handleSongContextMenu(e, song)}
                          >
                            <td>
                              <div className="title-cell" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
                                <button
                                  className={`heart-btn ${isSongFavorite(song) ? 'is-fav' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(song);
                                  }}
                                  title={isSongFavorite(song) ? "Quitar de Favoritas" : "Marcar como Favorita"}
                                  style={{ flexShrink: 0 }}
                                >
                                  <Heart size={13} fill={isSongFavorite(song) ? '#f43f5e' : 'none'} color={isSongFavorite(song) ? '#f43f5e' : 'currentColor'} />
                                </button>
                                {song.cover ? (
                                  <img src={song.cover} alt="Cover" className="cover-thumb" style={{ objectFit: song.isSquareCover ? 'cover' : 'contain', flexShrink: 0 }} />
                                ) : (
                                  <div className="cover-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Disc3 size={16} opacity={0.3} />
                                  </div>
                                )}
                                <span style={{ color: 'var(--text-highlight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={song.title}>
                                  {song.title}
                                </span>
                              </div>
                            </td>
                            <td>{song.artist}</td>
                            <td>{song.album}</td>
                            <td>{song.genre}</td>
                            <td>{song.year}</td>
                          </tr>
                        ))}
                        {displaySongs.length === 0 && (
                          <tr><td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>No se encontraron coincidencias.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div
                  className="inspector-panel"
                  onWheel={(e) => {
                    window.dispatchEvent(new CustomEvent('musicPlayer_wheelVolume', { detail: { deltaY: e.deltaY } }));
                  }}
                  style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
                >
                  <div className="inspector-content" style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '100%', width: '100%', minWidth: 0, flex: 1, minHeight: 0 }}>
                      {isCrossfading && prevSong && (
                        <div key={`old-${prevSong.id}`} className="crossfade-old" style={{ gridArea: '1 / 1', display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, overflow: 'hidden' }}>
                          <InspectorDetailsContent
                            song={prevSong}
                            isFavorite={prevSong ? isSongFavorite(prevSong) : false}
                            onToggleFavorite={() => prevSong && toggleFavorite(prevSong)}
                          />
                        </div>
                      )}
                      <div key={`new-${activeSong ? activeSong.id : 'empty'}`} className={isCrossfading ? 'crossfade-new' : ''} style={{ gridArea: '1 / 1', display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, overflow: 'hidden' }}>
                        <InspectorDetailsContent
                          song={activeSong}
                          isFavorite={activeSong ? isSongFavorite(activeSong) : false}
                          onToggleFavorite={() => activeSong && toggleFavorite(activeSong)}
                        />
                      </div>
                    </div>

                    <div
                      onDoubleClick={() => {
                        if (easterEggsEnabled) {
                          setIsSignatureEggActive(true);
                          setTimeout(() => setIsSignatureEggActive(false), 3000);
                        }
                      }}
                      style={{
                        marginTop: 'auto',
                        paddingTop: '16px',
                        paddingBottom: '6px',
                        textAlign: 'center',
                        fontSize: '10px',
                        color: isSignatureEggActive ? 'var(--accent-color)' : 'rgba(255,255,255,0.15)',
                        transition: 'color 0.8s ease',
                        userSelect: 'none',
                        flexShrink: 0
                      }}
                    >
                      {isSignatureEggActive ? 'No había un mejor nombre...' : 'Reproductor de música - Robert'}
                    </div>
                  </div>
                </div>
              </div>

              <div ref={dashboardScrollRef} style={{ paddingBottom: '40px', paddingRight: '40px', overflowY: 'auto', display: activeTab === 'dashboard' && stats ? 'block' : 'none' }}>

                {/* SECCION 1: METRICAS GENERALES */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', marginTop: '8px', flexWrap: 'wrap', gap: '12px' }}>
                  <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', margin: 0 }}>Resumen General</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      className="btn btn-outline"
                      onClick={exportToMarkdown}
                      style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Exportar análisis e informe completo de la biblioteca en archivo Markdown"
                    >
                      <Download size={13} /> Exportar Markdown
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={exportStatsJSON}
                      style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Exportar métricas y analíticas completas en archivo JSON estructurado"
                    >
                      <FileText size={13} /> Exportar JSON
                    </button>
                  </div>
                </div>
                <div className="dashboard-grid">
                  <div
                    className="stat-card"
                    onClick={() => {
                      if (easterEggsEnabled) {
                        setEggMessage("Necesitamos mas música.");
                        setTimeout(() => setEggMessage(''), 4000);
                      }
                    }}
                  >
                    <div className="stat-card-title">Canciones Escaneadas</div>
                    <div className="stat-value">{songs.length}</div>
                  </div>
                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Canciones de ${stats.topArtistName}`, stats.topArtistSongs)}>
                    <div className="stat-card-title">Compositor Principal</div>
                    <div className="stat-value" style={{ fontSize: '20px', marginBottom: '4px' }}>{stats.topArtistName}</div>
                    <div className="stat-sub">{stats.topArtistCount} apariciones en tu colección</div>
                  </div>
                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Canciones en ${stats.topAlbumName}`, stats.topAlbumSongs)}>
                    <div className="stat-card-title">Álbum más poblado</div>
                    <div className="stat-value" style={{ fontSize: '20px', marginBottom: '4px' }}>{stats.topAlbumName}</div>
                    <div className="stat-sub">{stats.topAlbumCount} pistas agrupadas</div>
                  </div>
                </div>

                {/* SECCION 2: GRAFICOS */}
                <div className="dashboard-grid" style={{ marginTop: '20px' }}>

                  <div className="stat-card">
                    <div className="stat-card-title">Distribución por Década</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '120px', marginTop: '24px' }}>
                      {decadesData.sorted.map(([decade, count]) => {
                        const maxCount = Math.max(...decadesData.sorted.map(d => d[1]));
                        const height = `${(count / maxCount) * 100}%`;
                        return (
                          <div
                            key={decade}
                            className="clickable"
                            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', flex: 1, height: '100%', cursor: 'pointer', transition: 'opacity 0.2s' }}
                            onClick={() => openModal(`Canciones de los ${decade}`, decadesData.decadeSongs[decade])}
                          >
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{count}</div>
                            <div style={{ width: '80%', backgroundColor: 'var(--accent-color)', height: height, borderRadius: '4px 4px 0 0', opacity: 0.8, minHeight: '4px' }}></div>
                            <div style={{ fontSize: '11px', marginTop: '8px', fontWeight: 500 }}>{decade}</div>
                          </div>
                        )
                      })}
                      {decadesData.sorted.length === 0 && <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Sin datos de año</span>}
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-card-title">Top Géneros Dominantes (Diversidad: {stats.uniqueGenres})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
                      {genresData.sorted.map(([genre, count]) => {
                        const maxCount = genresData.sorted[0]?.[1] || 1;
                        const width = `${(count / maxCount) * 100}%`;
                        return (
                          <div
                            key={genre}
                            className="clickable"
                            style={{ display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }}
                            onClick={() => openModal(`Canciones del género: ${genre}`, genresData.genreSongs[genre])}
                          >
                            <div style={{ width: '120px', fontSize: '12px', color: 'var(--text-highlight)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{genre}</div>
                            <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ width: width, backgroundColor: 'var(--accent-color)', height: '100%', borderRadius: '4px' }}></div>
                            </div>
                            <div style={{ width: '30px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>{count}</div>
                          </div>
                        )
                      })}
                      {genresData.sorted.length === 0 && <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Sin géneros</span>}
                    </div>
                  </div>
                </div>

                {/* SECCION 3: CRONOLOGIA */}
                <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '32px' }}>Cronología y Fechas</h3>
                <div className="dashboard-grid">
                  <div className="stat-card">
                    <div className="stat-card-title">Línea de Tiempo Analítica</div>
                    {stats.oldest !== 'N/A' && stats.newest !== 'N/A' ? (
                      <div style={{ position: 'relative', width: '100%', height: '60px', marginTop: '10px', display: 'flex', alignItems: 'center' }}>
                        <div style={{ position: 'absolute', top: '50%', left: '30px', right: '30px', height: '2px', backgroundColor: 'var(--border-color)', transform: 'translateY(-50%)' }}></div>
                        {stats.timelineData.map((d, i) => {
                          const totalSpan = stats.newest - stats.oldest;
                          const leftPos = totalSpan > 0 ? ((d.year - stats.oldest) / totalSpan) * 100 : 50;
                          const size = Math.max(8, Math.min(24, 6 + (d.count * 1.5)));
                          return (
                            <div
                              key={d.year}
                              className="clickable"
                              onClick={() => openModal(`Canciones del año ${d.year}`, sortAlpha(songs.filter(s => String(s.year).includes(String(d.year)))))}
                              style={{
                                position: 'absolute',
                                left: `calc(30px + calc(100% - 60px) * ${leftPos / 100})`,
                                top: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: `${size}px`,
                                height: `${size}px`,
                                backgroundColor: 'var(--accent-color)',
                                borderRadius: '50%',
                                border: '2px solid var(--bg-tertiary)',
                                cursor: 'pointer',
                                zIndex: 1,
                                opacity: 0.9,
                                transition: 'transform 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.4)';
                                e.currentTarget.style.zIndex = 2;
                                const tooltip = e.currentTarget.querySelector('.timeline-hover-tooltip');
                                if (tooltip) tooltip.style.opacity = '1';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                                e.currentTarget.style.zIndex = 1;
                                const tooltip = e.currentTarget.querySelector('.timeline-hover-tooltip');
                                if (tooltip) tooltip.style.opacity = '0';
                              }}
                            >
                              <span style={{ position: 'absolute', top: '100%', left: leftPos < 15 ? '0' : leftPos > 85 ? '100%' : '50%', transform: leftPos < 15 ? 'translateX(0)' : leftPos > 85 ? 'translateX(-100%)' : 'translateX(-50%)', marginTop: '6px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                {d.year === stats.oldest || d.year === stats.newest ? d.year : ''}
                              </span>
                              <div className="timeline-hover-tooltip" style={{ position: 'absolute', bottom: '100%', left: leftPos < 15 ? '0' : leftPos > 85 ? '100%' : '50%', transform: leftPos < 15 ? 'translateX(0)' : leftPos > 85 ? 'translateX(-100%)' : 'translateX(-50%)', marginBottom: '8px', padding: '4px 8px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 500, borderRadius: '4px', border: '1px solid var(--border-color)', opacity: 0, transition: 'opacity 0.2s', pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                {d.year}: {d.count} pistas
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Sin datos de año</span>
                    )}
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Canciones del ${stats.topYearName}`, stats.topYearSongs)}>
                    <div className="stat-card-title">Monopolio Anual</div>
                    <div className="stat-value" style={{ fontSize: '24px', marginBottom: '4px' }}>{stats.topYearName}</div>
                    <div className="stat-sub">El {stats.topYearPercent}% de tu biblioteca es del año {stats.topYearName}.</div>
                  </div>
                </div>

                {/* SALON DE LA FAMA */}
                <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '32px' }}>Salón de la Fama</h3>
                <div className="dashboard-grid">
                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Pista más corta (Duración)`, [stats.shortestDurationObj])}>
                    <div className="stat-card-title">Duración: Pestañeo</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.shortestDurationObj.title}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>La pista más corta de la biblioteca ({formatTime(stats.shortestDurationObj.duration || 0)}).</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Pista más larga (Duración)`, [stats.longestDurationObj])}>
                    <div className="stat-card-title">Duración: Epopeya</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.longestDurationObj.title}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>La pista más larga de la biblioteca ({formatTime(stats.longestDurationObj.duration || 0)}).</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Mayor Calidad`, [stats.highestBitrateObj])}>
                    <div className="stat-card-title">Audio: Calidad Audiófila</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.highestBitrateObj.title}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>El archivo con más datos por segundo ({stats.highestBitrateObj.bitrate}).</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Peor Calidad`, [stats.lowestBitrateObj])}>
                    <div className="stat-card-title">Audio: Papa Frita</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.lowestBitrateObj.title}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>El archivo más comprimido ({stats.lowestBitrateObj.bitrate}).</div>
                  </div>



                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Mayor Variedad de Letras`, [stats.mostDiverseCharsObj])}>
                    <div className="stat-card-title">Vocabulario Extremo</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.mostDiverseCharsName}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>{stats.mostDiverseCharsCount} caracteres alfanuméricos distintos.</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Menor Variedad de Letras`, [stats.leastDiverseCharsObj])}>
                    <div className="stat-card-title">Vocabulario Pobre</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.leastDiverseCharsName}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>Sólo {stats.leastDiverseCharsCount} caracteres alfanuméricos distintos.</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Título más corto`, [stats.shortestTitleObj])}>
                    <div className="stat-card-title">Título Expreso</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>"{stats.shortestTitleName}"</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>Sólo {stats.shortestTitleLength} caracteres en total.</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Canción más larga`, [stats.longestTitleObj])}>
                    <div className="stat-card-title">Título Interminable</div>
                    <div className="stat-value" style={{ fontSize: '16px', lineHeight: '1.2' }}>{stats.longestTitleName}</div>
                    <div className="stat-sub" style={{ marginTop: '8px' }}>La canción con el título más extenso ({stats.longestTitleLength} letras).</div>
                  </div>
                </div>

                {/* SECCION 4: METRICAS RARAS */}
                <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '32px' }}>Métricas Especiales & Locuras</h3>
                <div className="dashboard-grid">
                  <div className="stat-card">
                    <div className="stat-card-title">Fidelidad de Artistas</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginTop: '10px' }}>
                      <div className="clickable" style={{ cursor: 'pointer' }} onClick={() => openModal(`Artistas Prolíficos (>1 pista)`, stats.prolificSongs)}>
                        <div className="stat-value">{stats.prolificCount}</div>
                        <div className="stat-sub">Prolíficos (&gt;1 pista)</div>
                      </div>
                      <div style={{ width: '1px', height: '30px', backgroundColor: 'var(--border-color)', marginBottom: '8px' }}></div>
                      <div className="clickable" style={{ cursor: 'pointer' }} onClick={() => openModal(`One-Hit Wonders`, stats.fugacesSongs)}>
                        <div className="stat-value">{stats.fugacesCount}</div>
                        <div className="stat-sub">One-Hit Wonders</div>
                      </div>
                    </div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Títulos de 1 Palabra`, stats.oneWordSongs)}>
                    <div className="stat-card-title">Títulos Minimalistas (1 Palabra)</div>
                    <div className="stat-value">{stats.oneWordTitles}</div>
                    <div className="stat-sub">Canciones cuyos títulos consisten en exactamente 1 sola palabra.</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Canciones que empiezan con ${stats.topLetter}`, stats.topLetterSongs)}>
                    <div className="stat-card-title">Frecuencia Alfabética</div>
                    <div className="stat-value">{stats.topLetter}</div>
                    <div className="stat-sub">Letra más usada para iniciar las canciones.</div>
                  </div>

                  <div className="stat-card stat-card-clickable clickable" onClick={() => openModal(`Portadas Asimétricas (No 1:1)`, stats.nonSquareSongs)}>
                    <div className="stat-card-title">Arte de Tapa Irregular</div>
                    <div className="stat-value" style={{ color: stats.nonSquareSongs.length > 0 ? '#ffcc00' : 'var(--text-secondary)' }}>{stats.nonSquareSongs.length}</div>
                    <div className="stat-sub">Canciones cuya portada incrustada no es un cuadrado perfecto (No 1:1).</div>
                  </div>

                  <div className="stat-card" style={{ gridColumn: 'span 2' }}>
                    <div className="stat-card-title">Análisis Semántico de Títulos</div>
                    <div style={{ display: 'flex', gap: '24px', marginTop: '10px' }}>
                      <div className="clickable" style={{ cursor: 'pointer' }} onClick={() => openModal(`Títulos Gritones (MAYÚSCULAS)`, stats.upperCaseSongs)}>
                        <div className="stat-value" style={{ color: stats.upperCaseTitles > 0 ? '#ffcc00' : 'var(--text-secondary)' }}>{stats.upperCaseTitles}</div>
                        <div className="stat-sub">Pistas Gritonas (Títulos 100% en MAYÚSCULAS)</div>
                      </div>
                      <div className="clickable" style={{ cursor: 'pointer' }} onClick={() => openModal(`Títulos con Anotaciones Complejas`, stats.bracketsSongs)}>
                        <div className="stat-value">{stats.bracketsPercent}%</div>
                        <div className="stat-sub">Pistas Complejas (Tienen anotaciones como [Live] o Remasters)</div>
                      </div>
                      <div>
                        <div className="stat-value">{stats.avgWords}</div>
                        <div className="stat-sub">Palabras en promedio por título en tu biblioteca</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SMART PLAYLISTS PANEL */}
              <div
                ref={playlistsScrollRef}
                style={{
                  display: activeTab === 'playlists' ? 'block' : 'none',
                  paddingRight: '20px',
                  paddingBottom: '40px',
                  overflowY: 'auto'
                }}
                className="smart-playlists-panel"
              >
                <div className="smart-header-row">
                  <div>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', margin: '0 0 6px 0', letterSpacing: '0.5px' }}>
                      Listas Dinámicas Inteligentes
                    </h3>
                    <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      Colecciones calculadas automáticamente en vivo según tus hábitos de escucha, metadatos y reglas personalizadas.
                    </p>
                  </div>
                  <button
                    className="btn"
                    onClick={() => {
                      setEditingSmartPlaylist({
                        id: `custom-${Date.now()}`,
                        name: '',
                        desc: '',
                        category: 'custom',
                        matchType: 'all',
                        rules: [{ field: 'genre', operator: 'contains', value: '' }],
                        sort: 'random',
                        limit: 50,
                        isCustom: true
                      });
                      setShowSmartBuilderModal(true);
                    }}
                    style={{
                      backgroundColor: 'var(--accent-color)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      fontWeight: 600,
                      boxShadow: '0 4px 12px color-mix(in srgb, var(--accent-color) 30%, transparent)'
                    }}
                  >
                    <Plus size={14} /> Nueva Lista Dinámica
                  </button>
                </div>

                {/* Filtros por Categoría */}
                <div className="smart-filters-row">
                  {[
                    { id: 'all', label: 'Todas las Colecciones' },
                    { id: 'habits', label: 'Mis Hábitos & Favoritas' },
                    { id: 'audio', label: 'Alta Fidelidad (Hi-Fi)' },
                    { id: 'decades', label: 'Décadas & Épocas' },
                    { id: 'catalog', label: 'Catálogo & Prolíficos' },
                    { id: 'duration', label: 'Por Duración' },
                    { id: 'custom', label: `Personalizadas (${customSmartPlaylists.length})` }
                  ].map(tab => (
                    <div
                      key={tab.id}
                      className={`smart-filter-chip ${smartFilterTab === tab.id ? 'active' : ''}`}
                      onClick={() => setSmartFilterTab(tab.id)}
                    >
                      {tab.label}
                    </div>
                  ))}
                </div>

                {/* Grid de Listas Dinámicas */}
                <div className="smart-grid">
                  {displaySmartPlaylists.map(playlist => {
                    const matchingSongs = getPlaylistSongs(playlist);
                    const IconComponent = playlist.icon || Sparkles;
                    const covers = matchingSongs.filter(s => s.cover).slice(0, 4).map(s => s.cover);

                    return (
                      <div
                        key={playlist.id}
                        className="smart-card"
                        onClick={() => handleOpenSmartPlaylist(playlist, false)}
                      >
                        <div className="smart-card-top">
                          {covers.length >= 4 ? (
                            <div className="smart-card-collage">
                              {covers.map((c, idx) => (
                                <img key={idx} src={c} alt="Cover" />
                              ))}
                            </div>
                          ) : covers.length > 0 ? (
                            <div className="smart-card-single-art" style={{ position: 'relative' }}>
                              <img src={covers[0]} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.65))', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: '4px' }}>
                                <IconComponent size={14} color="#fff" />
                              </div>
                            </div>
                          ) : (
                            <div className="smart-card-single-art">
                              <IconComponent size={26} />
                            </div>
                          )}

                          <div className="smart-card-meta">
                            <div className="smart-card-title" title={playlist.name}>
                              {playlist.name}
                            </div>
                            <div className="smart-card-desc" title={playlist.desc}>
                              {playlist.desc || 'Filtro dinámico de metadatos'}
                            </div>
                          </div>
                        </div>

                        <div className="smart-card-footer" onClick={e => e.stopPropagation()}>
                          <div className="smart-card-badge">
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: playlist.badgeColor || 'var(--accent-color)' }} />
                            <span>{matchingSongs.length} pista{matchingSongs.length !== 1 ? 's' : ''}</span>
                          </div>

                          <div className="smart-card-actions">
                            {playlist.isCustom && (
                              <>
                                <button
                                  className="btn btn-outline"
                                  onClick={() => {
                                    setEditingSmartPlaylist({ ...playlist });
                                    setShowSmartBuilderModal(true);
                                  }}
                                  style={{ padding: '3px 7px', height: '24px' }}
                                  title="Editar reglas de la lista"
                                >
                                  <Edit3 size={11} />
                                </button>
                                <button
                                  className="btn btn-outline"
                                  onClick={() => handleDeleteCustomPlaylist(playlist.id)}
                                  style={{ padding: '3px 7px', height: '24px', color: '#ef4444' }}
                                  title="Eliminar lista dinámica"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </>
                            )}

                            <button
                              className="btn btn-outline"
                              onClick={() => handleOpenSmartPlaylist(playlist, false)}
                              style={{ padding: '3px 9px', fontSize: '11px', height: '24px' }}
                            >
                              Ver
                            </button>

                            <button
                              className="btn"
                              disabled={matchingSongs.length === 0}
                              onClick={() => handleOpenSmartPlaylist(playlist, true)}
                              style={{
                                padding: '3px 10px',
                                fontSize: '11px',
                                height: '24px',
                                backgroundColor: 'var(--accent-color)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              title="Reproducir lista inteligente de inmediato"
                            >
                              <Play size={10} fill="#fff" /> Reproducir
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* MODAL CONSTRUCTOR DE LISTAS INTELIGENTES */}
              {showSmartBuilderModal && editingSmartPlaylist && (
                <div className="smart-modal-overlay" onClick={() => setShowSmartBuilderModal(false)}>
                  <div className="smart-modal" onClick={e => e.stopPropagation()}>
                    <div className="smart-modal-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={16} color="var(--accent-color)" />
                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-highlight)' }}>
                          {editingSmartPlaylist.isCustom && customSmartPlaylists.some(p => p.id === editingSmartPlaylist.id)
                            ? 'Editar Lista Dinámica'
                            : 'Nueva Lista Dinámica'}
                        </h3>
                      </div>
                      <button
                        className="btn-icon"
                        onClick={() => setShowSmartBuilderModal(false)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="smart-modal-body">
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          Nombre de la Lista
                        </label>
                        <input
                          type="text"
                          className="search-input"
                          style={{ width: '100%', boxSizing: 'border-box' }}
                          placeholder="Ej. Mi Rock de los 90..."
                          value={editingSmartPlaylist.name}
                          onChange={e => setEditingSmartPlaylist(prev => ({ ...prev, name: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          Descripción (opcional)
                        </label>
                        <input
                          type="text"
                          className="search-input"
                          style={{ width: '100%', boxSizing: 'border-box' }}
                          placeholder="Ej. Pistas seleccionadas con filtros en vivo..."
                          value={editingSmartPlaylist.desc || ''}
                          onChange={e => setEditingSmartPlaylist(prev => ({ ...prev, desc: e.target.value }))}
                        />
                      </div>

                      {/* Lógica de coincidencia */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Condición:</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-highlight)', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="matchType"
                            checked={editingSmartPlaylist.matchType === 'all'}
                            onChange={() => setEditingSmartPlaylist(prev => ({ ...prev, matchType: 'all' }))}
                          />
                          Cumplir TODAS las reglas (Y / AND)
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-highlight)', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="matchType"
                            checked={editingSmartPlaylist.matchType === 'any'}
                            onChange={() => setEditingSmartPlaylist(prev => ({ ...prev, matchType: 'any' }))}
                          />
                          Cumplir AL MENOS UNA regla (O / OR)
                        </label>
                      </div>

                      {/* Lista de Reglas */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            Reglas de Filtrado Dinámico
                          </label>
                          <button
                            className="btn btn-outline"
                            type="button"
                            onClick={() => {
                              setEditingSmartPlaylist(prev => ({
                                ...prev,
                                rules: [...prev.rules, { field: 'genre', operator: 'contains', value: '' }]
                              }));
                            }}
                            style={{ padding: '2px 8px', fontSize: '11px', height: '22px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Plus size={11} /> Añadir Regla
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {editingSmartPlaylist.rules.map((rule, rIdx) => (
                            <div key={rIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-tertiary)', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
                              {/* Campo */}
                              <select
                                value={rule.field}
                                onChange={e => {
                                  const nextField = e.target.value;
                                  setEditingSmartPlaylist(prev => {
                                    const newRules = [...prev.rules];
                                    newRules[rIdx] = { ...newRules[rIdx], field: nextField };
                                    return { ...prev, rules: newRules };
                                  });
                                }}
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-highlight)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '4px 6px', fontSize: '11.5px' }}
                              >
                                <option value="genre">Género</option>
                                <option value="artist">Artista</option>
                                <option value="album">Álbum</option>
                                <option value="title">Título</option>
                                <option value="year">Año</option>
                                <option value="bitrate">Bitrate (kbps)</option>
                                <option value="duration">Duración (segundos)</option>
                                <option value="isFavorite">Es Favorita</option>
                                <option value="playCount">Reproducciones</option>
                              </select>

                              {/* Operador */}
                              <select
                                value={rule.operator}
                                onChange={e => {
                                  const nextOp = e.target.value;
                                  setEditingSmartPlaylist(prev => {
                                    const newRules = [...prev.rules];
                                    newRules[rIdx] = { ...newRules[rIdx], operator: nextOp };
                                    return { ...prev, rules: newRules };
                                  });
                                }}
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-highlight)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '4px 6px', fontSize: '11.5px' }}
                              >
                                {rule.field === 'isFavorite' ? (
                                  <>
                                    <option value="isTrue">Sí (Marcada ❤️)</option>
                                    <option value="isFalse">No (Sin marcar)</option>
                                  </>
                                ) : rule.field === 'year' || rule.field === 'bitrate' || rule.field === 'duration' || rule.field === 'playCount' ? (
                                  <>
                                    <option value="greaterThan">Mayor o igual (≥)</option>
                                    <option value="lessThan">Menor o igual (≤)</option>
                                    <option value="equals">Exactamente igual (=)</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="contains">Contiene texto</option>
                                    <option value="equals">Es exactamente igual a</option>
                                  </>
                                )}
                              </select>

                              {/* Valor */}
                              {rule.field !== 'isFavorite' && (
                                <input
                                  type={rule.field === 'year' || rule.field === 'bitrate' || rule.field === 'duration' || rule.field === 'playCount' ? 'number' : 'text'}
                                  className="search-input"
                                  style={{ flex: 1, minWidth: '100px', height: '26px', fontSize: '11.5px', padding: '0 8px' }}
                                  placeholder="Valor a comparar..."
                                  value={rule.value}
                                  onChange={e => {
                                    const nextVal = e.target.value;
                                    setEditingSmartPlaylist(prev => {
                                      const newRules = [...prev.rules];
                                      newRules[rIdx] = { ...newRules[rIdx], value: nextVal };
                                      return { ...prev, rules: newRules };
                                    });
                                  }}
                                />
                              )}

                              {/* Botón eliminar regla */}
                              {editingSmartPlaylist.rules.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSmartPlaylist(prev => ({
                                      ...prev,
                                      rules: prev.rules.filter((_, i) => i !== rIdx)
                                    }));
                                  }}
                                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                                  title="Eliminar regla"
                                >
                                  <X size={13} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Límite y Orden */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                            Orden de Canciones
                          </label>
                          <select
                            value={editingSmartPlaylist.sort || 'random'}
                            onChange={e => setEditingSmartPlaylist(prev => ({ ...prev, sort: e.target.value }))}
                            style={{ width: '100%', background: 'var(--bg-tertiary)', color: 'var(--text-highlight)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' }}
                          >
                            <option value="random">Aleatorio (Modo Mezcla)</option>
                            <option value="mostPlayed">Más reproducidas primero</option>
                            <option value="yearDesc">Año más reciente primero</option>
                            <option value="titleAsc">Título alfabético (A-Z)</option>
                          </select>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                            Límite Máximo
                          </label>
                          <select
                            value={editingSmartPlaylist.limit || 50}
                            onChange={e => setEditingSmartPlaylist(prev => ({ ...prev, limit: parseInt(e.target.value, 10) }))}
                            style={{ width: '100%', background: 'var(--bg-tertiary)', color: 'var(--text-highlight)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' }}
                          >
                            <option value={25}>Máximo 25 pistas</option>
                            <option value={50}>Máximo 50 pistas</option>
                            <option value={100}>Máximo 100 pistas</option>
                            <option value={0}>Sin límite (Todas las coincidentes)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="smart-modal-footer">
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }} />
                        <span>
                          Vista previa: <strong style={{ color: 'var(--text-highlight)' }}>{getPlaylistSongs(editingSmartPlaylist).length}</strong> canciones coinciden
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="btn btn-outline"
                          type="button"
                          onClick={() => setShowSmartBuilderModal(false)}
                          style={{ padding: '6px 14px', fontSize: '12px' }}
                        >
                          Cancelar
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={handleSaveCustomPlaylist}
                          style={{ backgroundColor: 'var(--accent-color)', color: '#fff', padding: '6px 16px', fontSize: '12px', fontWeight: 600 }}
                        >
                          Guardar Lista Dinámica
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* EXPLORE PANEL */}
              <div ref={exploreScrollRef} style={{ display: activeTab === 'explore' ? 'block' : 'none', paddingRight: '20px', paddingBottom: '40px', overflowY: 'auto' }}>
                {exploreView === 'home' ? (
                  <div>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '24px', marginTop: '8px' }}>Exploración de Biblioteca</h3>
                    <div className="explore-grid">
                      <div className="explore-card" onClick={() => setExploreView('artists')}>
                        <div className="explore-card-bg">
                          <div className="explore-marquee">
                            {exploreData?.cardCovers.artists.map((c, i) => <img key={`a1-${i}`} src={c} alt="cover" />)}
                            {exploreData?.cardCovers.artists.map((c, i) => <img key={`a2-${i}`} src={c} alt="cover" />)}
                          </div>
                        </div>
                        <div className="explore-card-gradient"></div>
                        <div className="explore-card-content">
                          <div className="explore-card-icon"><Mic2 size={32} /></div>
                          <div style={{ textAlign: 'center' }}>
                            <div className="explore-card-title">Artistas</div>
                            <div className="explore-card-subtitle">Explorar creadores</div>
                          </div>
                        </div>
                      </div>
                      <div className="explore-card" onClick={() => setExploreView('albums')}>
                        <div className="explore-card-bg">
                          <div className="explore-marquee" style={{ animationDirection: 'reverse', animationDuration: '35s' }}>
                            {exploreData?.cardCovers.albums.map((c, i) => <img key={`al1-${i}`} src={c} alt="cover" />)}
                            {exploreData?.cardCovers.albums.map((c, i) => <img key={`al2-${i}`} src={c} alt="cover" />)}
                          </div>
                        </div>
                        <div className="explore-card-gradient"></div>
                        <div className="explore-card-content">
                          <div className="explore-card-icon"><Disc size={32} /></div>
                          <div style={{ textAlign: 'center' }}>
                            <div className="explore-card-title">Álbumes</div>
                            <div className="explore-card-subtitle">Explorar colecciones</div>
                          </div>
                        </div>
                      </div>
                      <div className="explore-card" onClick={() => setExploreView('genres')}>
                        <div className="explore-card-bg">
                          <div className="explore-marquee" style={{ animationDuration: '25s' }}>
                            {exploreData?.cardCovers.genres.map((c, i) => <img key={`g1-${i}`} src={c} alt="cover" />)}
                            {exploreData?.cardCovers.genres.map((c, i) => <img key={`g2-${i}`} src={c} alt="cover" />)}
                          </div>
                        </div>
                        <div className="explore-card-gradient"></div>
                        <div className="explore-card-content">
                          <div className="explore-card-icon"><Layers size={32} /></div>
                          <div style={{ textAlign: 'center' }}>
                            <div className="explore-card-title">Géneros</div>
                            <div className="explore-card-subtitle">Explorar por estilos</div>
                          </div>
                        </div>
                      </div>
                      <div className="explore-card" onClick={() => setExploreView('years')}>
                        <div className="explore-card-bg">
                          <div className="explore-marquee" style={{ animationDirection: 'reverse', animationDuration: '40s' }}>
                            {exploreData?.cardCovers.years.map((c, i) => <img key={`y1-${i}`} src={c} alt="cover" />)}
                            {exploreData?.cardCovers.years.map((c, i) => <img key={`y2-${i}`} src={c} alt="cover" />)}
                          </div>
                        </div>
                        <div className="explore-card-gradient"></div>
                        <div className="explore-card-content">
                          <div className="explore-card-icon"><Calendar size={32} /></div>
                          <div style={{ textAlign: 'center' }}>
                            <div className="explore-card-title">Años</div>
                            <div className="explore-card-subtitle">Explorar cronología</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '24px', marginTop: '48px' }}>Descubrimiento Especial</h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>

                      {/* Random Album */}
                      {exploreData?.randomAlbum && (
                        <div className="album-rec-card" onClick={() => {
                          setPlaylistTitle(`Álbum: ${exploreData.randomAlbum[0]}`);
                          setBaseList(exploreData.randomAlbum[1]);
                          handleSelectSong(exploreData.randomAlbum[1][0], true);
                        }}>
                          <div className="album-rec-bg" style={{ backgroundImage: `url(${exploreData.randomAlbum[1][0]?.cover || ''})` }}></div>
                          <div className="album-rec-content">
                            {exploreData.randomAlbum[1][0]?.cover ? (
                              <img src={exploreData.randomAlbum[1][0].cover} className="album-rec-cover" alt="Album Cover" />
                            ) : (
                              <div className="album-rec-cover" style={{ backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Disc size={40} opacity={0.3} />
                              </div>
                            )}
                            <div className="album-rec-info">
                              <span className="album-rec-label">Álbum Recomendado</span>
                              <span className="album-rec-title" title={exploreData.randomAlbum[0]}>{exploreData.randomAlbum[0]}</span>
                              <span className="album-rec-tracks">{exploreData.randomAlbum[1].length} pistas • {exploreData.randomAlbum[1][0].artist}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Random Roulette */}
                      <div className="roulette-card" onClick={playRoulette} style={{ cursor: rouletteSpinning ? 'default' : 'pointer' }}>
                        <div className="roulette-bg">
                          <Shuffle size={140} />
                        </div>
                        <div className="roulette-content" style={{ flex: 1 }}>
                          <div className="roulette-icon-wrapper" style={{ animation: rouletteSpinning ? 'fastSpin 0.4s linear infinite' : 'none' }}>
                            <Shuffle size={24} color="#fff" />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="roulette-title">Ruleta Musical</span>
                            <span className="roulette-desc">{rouletteSpinning ? 'Girando la ruleta...' : 'Tira los dados para reproducir 6 pistas al azar'}</span>
                          </div>
                        </div>
                        <div className="roulette-display">
                          {rouletteSpinning ? (
                            <div className="roulette-spinner">
                              <div className="roulette-strip">
                                {exploreData?.cardCovers.artists.map((c, i) => <img key={`rs1-${i}`} src={c} alt="" />)}
                                {exploreData?.cardCovers.albums.map((c, i) => <img key={`rs2-${i}`} src={c} alt="" />)}
                              </div>
                            </div>
                          ) : rouletteResult ? (
                            <div className="roulette-winner">
                              {rouletteResult.cover ? <img src={rouletteResult.cover} alt="Winner" /> : <div className="placeholder"><Music size={32} opacity={0.3} /></div>}
                              <div className="winner-title">{rouletteResult.title}</div>
                              <div className="winner-artist">{rouletteResult.artist}</div>
                            </div>
                          ) : (
                            <div className="roulette-idle">
                              <Disc3 size={48} opacity={0.2} style={{ color: 'var(--text-secondary)' }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', position: 'sticky', top: '-32px', backgroundColor: 'var(--bg-primary)', zIndex: 10, padding: '32px 0 16px 0', borderBottom: '1px solid var(--border-color)', margin: '-32px 0 24px 0' }}>
                      <button className="btn btn-outline" onClick={() => setExploreView('home')} style={{ padding: '6px' }} title="Volver al inicio">
                        <ChevronLeft size={16} />
                      </button>
                      <h3 style={{ fontSize: '16px', color: 'var(--text-highlight)', margin: 0, textTransform: 'capitalize' }}>
                        {exploreView === 'artists' ? 'Artistas' : exploreView === 'albums' ? 'Álbumes' : exploreView === 'genres' ? 'Géneros' : 'Años'}
                      </h3>
                    </div>
                    <div className="explore-item-grid">
                      {(() => {
                        let items = [];
                        if (exploreView === 'artists') {
                          const map = {};
                          songs.forEach(s => { if (s.artist !== 'Desconocido') { map[s.artist] = (map[s.artist] || 0) + 1; } });
                          items = Object.entries(map).map(([k, v]) => ({ title: k, count: v, list: songs.filter(s => s.artist === k) }));
                        } else if (exploreView === 'albums') {
                          const map = {};
                          songs.forEach(s => { if (s.album !== 'Desconocido') { map[s.album] = (map[s.album] || 0) + 1; } });
                          items = Object.entries(map).map(([k, v]) => ({ title: k, count: v, list: songs.filter(s => s.album === k) }));
                        } else if (exploreView === 'genres') {
                          const { genreSongs } = getTopGenres();
                          items = Object.entries(genreSongs).map(([k, list]) => ({ title: k, count: list.length, list }));
                        } else if (exploreView === 'years') {
                          const map = {};
                          songs.forEach(s => {
                            const y = String(s.year).match(/\d{4}/)?.[0];
                            if (y) { map[y] = (map[y] || 0) + 1; }
                          });
                          items = Object.entries(map).map(([k, v]) => ({ title: k, count: v, list: songs.filter(s => String(s.year).includes(k)) }));
                        }
                        items.sort((a, b) => a.title.localeCompare(b.title));
                        return items.map(item => {
                          const firstCover = item.list.find(s => s.cover)?.cover;
                          const titlePrefix = exploreView === 'artists' ? 'Artista' : exploreView === 'albums' ? 'Álbum' : exploreView === 'genres' ? 'Género' : exploreView === 'years' ? 'Año' : 'Pistas';
                          return (
                            <div key={item.title} className="explore-item-card" onClick={() => openModal(`${titlePrefix}: ${item.title}`, sortAlpha(item.list))}>
                              {firstCover ? (
                                <img src={firstCover} className="explore-item-cover" alt={item.title} />
                              ) : (
                                <div className="explore-item-cover">
                                  <Music size={32} opacity={0.3} />
                                </div>
                              )}
                              <div className="explore-item-title" title={item.title}>{item.title}</div>
                              <div className="explore-item-count">{item.count} {item.count === 1 ? 'pista' : 'pistas'}</div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* SETTINGS PANEL */}
              <div ref={settingsScrollRef} style={{ paddingBottom: '40px', paddingRight: '40px', overflowY: 'auto', display: activeTab === 'settings' ? 'block' : 'none' }}>
                
                {/* NAVEGACIÓN POR SUB-PESTAÑAS DE CONFIGURACIÓN */}
                <div style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  backgroundColor: 'var(--bg-primary)',
                  display: 'flex',
                  gap: '6px',
                  marginBottom: '20px',
                  paddingTop: '8px',
                  paddingBottom: '12px',
                  flexWrap: 'wrap',
                  borderBottom: '1px solid var(--border-color)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}>
                  <button
                    className={`btn ${settingsCategory === 'appearance' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('appearance')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}
                  >
                    <Sparkles size={14} /> Apariencia
                  </button>
                  <button
                    className={`btn ${settingsCategory === 'zen' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('zen')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}
                  >
                    <Activity size={14} /> Modo Zen & Audio
                  </button>
                  <button
                    className={`btn ${settingsCategory === 'pip' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('pip')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}
                  >
                    <PictureInPicture2 size={14} /> Mini-Reproductor
                  </button>
                  <button
                    className={`btn ${settingsCategory === 'timer' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('timer')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}
                  >
                    <Moon size={14} /> Temporizador
                  </button>
                  <button
                    className={`btn ${settingsCategory === 'hotkeys' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('hotkeys')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}
                  >
                    <Sliders size={14} /> Atajos de Teclado
                  </button>
                  <button
                    className={`btn ${settingsCategory === 'system' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('system')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}
                  >
                    <Settings size={14} /> Sistema
                  </button>
                  <button
                    className={`btn ${settingsCategory === 'all' ? '' : 'btn-outline'}`}
                    onClick={() => setSettingsCategory('all')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px', color: 'var(--text-secondary)' }}
                  >
                    Ver Todo
                  </button>
                </div>

                {/* 1. SECCIÓN: APARIENCIA */}
                {(settingsCategory === 'appearance' || settingsCategory === 'all') && (
                  <div style={{ marginBottom: '28px' }}>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '4px' }}>Personalización</h3>

                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      <h4 style={{ color: 'var(--text-highlight)', marginBottom: '12px', fontSize: '14px', fontWeight: 500 }}>Colores de la Interfaz</h4>
                      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '12px' }}>Define el color de acentuación del entorno. Elige bien.</p>

                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {[
                          { name: 'Azul Default', hex: '#007acc' },
                          { name: 'Azul Bonito', hex: '#0ea5e9' },
                          { name: 'Aqua también bonito', hex: '#06b6d4' },
                          { name: 'Cian Radioactivo', hex: '#22d3ee' },
                          { name: 'Rosita Fresita', hex: '#f8aabc' },
                          { name: 'Rosa Mexicano', hex: '#ec4899' },
                          { name: 'Rosa Chicle', hex: '#ff007b' },
                          { name: 'Rojo Escarlata', hex: '#e11d48' },
                          { name: 'Carmesí Clásico', hex: '#be123c' },
                          { name: 'Vino Tinto', hex: '#831843' },
                          { name: 'Naranja Cítrico', hex: '#f97316' },
                          { name: 'Oro Fino', hex: '#f59e0b' },
                          { name: 'Amarillo Patito', hex: '#fef08a' },
                          { name: 'Verde Tóxico', hex: '#84cc16' },
                          { name: 'Verde Limón', hex: '#40d961' },
                          { name: 'Verde Hacker', hex: '#10b981' },
                          { name: 'Verde Bosque', hex: '#166534' },
                          { name: 'Cantera Índigo', hex: '#3e67ff' },
                          { name: 'Morado bonito', hex: '#8b5cf6' },
                          { name: 'Morado feo', hex: '#5d49d9' },
                          { name: 'Color feo', hex: '#581c87' },
                          { name: 'Negro casi total', hex: '#050505' },
                          { name: 'Ceniza Oscura', hex: '#737373' },
                          { name: 'Gris aburrido', hex: '#9ca3af' },
                          { name: 'Blanco Gélido', hex: '#e5e5e5' },
                          { name: 'Blanco Ciego', hex: '#f8fafc' }
                        ].map(color => (
                          <div
                            key={color.hex}
                            onClick={() => {
                              setAccentColor(color.hex);
                              if (easterEggsEnabled && color.name === 'Color feo') {
                                setEggMessage("Ni a mi me gusta este color.");
                                setTimeout(() => setEggMessage(''), 3000);
                              }
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px',
                              padding: '8px 12px', borderRadius: '4px',
                              border: `1px solid ${accentColor === color.hex ? color.hex : 'var(--border-color)'}`,
                              backgroundColor: accentColor === color.hex ? `${color.hex}15` : 'transparent',
                              cursor: 'pointer', transition: 'all 0.2s'
                            }}
                          >
                            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: color.hex }}></div>
                            <span style={{ color: accentColor === color.hex ? 'var(--text-highlight)' : 'var(--text-secondary)', fontSize: '12px' }}>{color.name}</span>
                          </div>
                        ))}
                      </div>

                      {/* TUS COLORES PERSONALIZADOS */}
                      {customAccentColors.length > 0 && (
                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-highlight)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Heart size={13} style={{ color: 'var(--accent-color)' }} /> Tus Colores Personalizados ({customAccentColors.length})
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {customAccentColors.map(color => {
                              const isSelected = accentColor.toLowerCase() === color.hex.toLowerCase();
                              return (
                                <div
                                  key={color.id || color.hex}
                                  onClick={() => setAccentColor(color.hex)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '7px 12px',
                                    borderRadius: '6px',
                                    border: `1.5px solid ${isSelected ? color.hex : 'var(--border-color)'}`,
                                    backgroundColor: isSelected ? `${color.hex}18` : 'var(--bg-tertiary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    boxShadow: isSelected ? `0 0 10px ${color.hex}30` : 'none'
                                  }}
                                  title={`Activar tema: ${color.name} (${color.hex})`}
                                >
                                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: color.hex, flexShrink: 0, boxShadow: `0 0 6px ${color.hex}80` }}></div>
                                  <span style={{ color: isSelected ? 'var(--text-highlight)' : 'var(--text-primary)', fontSize: '12px', fontWeight: isSelected ? 600 : 400 }}>{color.name}</span>
                                  <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)', opacity: 0.7, fontFamily: 'monospace' }}>{color.hex.toUpperCase()}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteCustomColor(color.id, e)}
                                    title="Eliminar este color personalizado"
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: '2px 4px',
                                      marginLeft: '4px',
                                      color: 'var(--text-secondary)',
                                      cursor: 'pointer',
                                      borderRadius: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      opacity: 0.6,
                                      transition: 'opacity 0.15s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* SELECTOR MANUAL ROBUSTO (CREAR COLOR) */}
                      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                        <div style={{ marginBottom: '12px' }}>
                          <h5 style={{ margin: '0 0 4px 0', color: 'var(--text-highlight)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Sparkles size={14} style={{ color: 'var(--accent-color)' }} /> Selector y Creador de Color Manual
                          </h5>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '11.5px', lineHeight: 1.4 }}>
                            Elige con precisión cualquier tonalidad mediante el selector visual, introduce un código hexadecimal y ponle un nombre propio a tu tema.
                          </p>
                        </div>

                        <form onSubmit={handleSaveCustomColor} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                            {/* Color swatch con input color nativo integrado */}
                            <div style={{ position: 'relative', width: '38px', height: '38px', borderRadius: '8px', overflow: 'hidden', border: '1.5px solid var(--border-color)', backgroundColor: manualColorHex, flexShrink: 0, boxShadow: `0 0 12px ${manualColorHex}40`, cursor: 'pointer' }} title="Haz clic para abrir el selector visual de color">
                              <input
                                type="color"
                                value={manualColorHex.startsWith('#') && manualColorHex.length === 7 ? manualColorHex : '#6366f1'}
                                onChange={(e) => setManualColorHex(e.target.value.toLowerCase())}
                                style={{
                                  position: 'absolute',
                                  inset: '-10px',
                                  width: '200%',
                                  height: '200%',
                                  opacity: 0,
                                  cursor: 'pointer'
                                }}
                              />
                            </div>

                            {/* Botón de Cuentagotas / Eyedropper si el navegador lo soporta */}
                            {typeof window !== 'undefined' && window.EyeDropper && (
                              <button
                                type="button"
                                onClick={handlePickScreenColor}
                                title="Tomar color de cualquier parte de la pantalla (Cuentagotas)"
                                style={{
                                  height: '38px',
                                  padding: '0 12px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--bg-tertiary)',
                                  color: 'var(--text-primary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '12px',
                                  cursor: 'pointer'
                                }}
                              >
                                <Edit3 size={13} style={{ color: 'var(--accent-color)' }} />
                                <span>Cuentagotas</span>
                              </button>
                            )}

                            {/* Campo Hexadecimal */}
                            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0 10px', height: '38px' }}>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600, marginRight: '2px', fontFamily: 'monospace' }}>#</span>
                              <input
                                type="text"
                                maxLength={7}
                                placeholder="6366F1"
                                value={manualColorHex.replace(/^#/, '')}
                                onChange={(e) => {
                                  const val = e.target.value.trim().replace(/[^0-9a-fA-F]/g, '');
                                  setManualColorHex('#' + val);
                                }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text-highlight)',
                                  fontFamily: 'monospace',
                                  fontSize: '13px',
                                  textTransform: 'uppercase',
                                  width: '74px',
                                  outline: 'none'
                                }}
                              />
                            </div>

                            {/* Campo Nombre del Color */}
                            <input
                              type="text"
                              placeholder="Nombre del tema (ej. Azul Cósmico, Fuego...)"
                              value={manualColorName}
                              onChange={(e) => setManualColorName(e.target.value)}
                              style={{
                                flex: 1,
                                minWidth: '180px',
                                height: '38px',
                                padding: '0 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-highlight)',
                                fontSize: '12.5px',
                                outline: 'none'
                              }}
                            />

                            {/* Botón Guardar y Aplicar */}
                            <button
                              type="submit"
                              style={{
                                height: '38px',
                                padding: '0 16px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: 'var(--accent-color)',
                                color: '#ffffff',
                                fontWeight: 600,
                                fontSize: '12.5px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'opacity 0.2s',
                                flexShrink: 0
                              }}
                            >
                              <Plus size={14} />
                              <span>Guardar y Aplicar</span>
                            </button>
                          </div>

                          {/* Vista Previa en Vivo */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Vista previa del tema:</span>
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '5px 12px',
                                borderRadius: '4px',
                                border: `1px solid ${manualColorHex}`,
                                backgroundColor: `${manualColorHex}18`,
                                boxShadow: `0 0 10px ${manualColorHex}30`
                              }}
                            >
                              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: manualColorHex }}></div>
                              <span style={{ color: 'var(--text-highlight)', fontSize: '11.5px', fontWeight: 500 }}>
                                {manualColorName.trim() || `Tema ${manualColorHex.toUpperCase()}`}
                              </span>
                            </div>
                          </div>
                        </form>
                      </div>
                    </div>

                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px' }}>Visualizadores y Rendimiento</h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      {/* ALTO RENDIMIENTO GPU */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Zap size={15} style={{ color: 'var(--accent-color)' }} /> Aceleración por GPU de Alto Rendimiento
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>
                            Fuerza al navegador y sistema operativo a asignar la GPU dedicada (NVIDIA / AMD) y renderizar visualizadores sin caídas de cuadros.
                          </p>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={highPerfGPU}
                            onChange={(e) => setHighPerfGPU(e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: highPerfGPU ? 'var(--accent-color)' : 'var(--border-light)',
                            borderRadius: '20px', transition: '0.2s'
                          }}>
                            <span style={{
                              position: 'absolute', content: '""', height: '14px', width: '14px',
                              left: highPerfGPU ? '19px' : '3px', bottom: '3px',
                              backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                            }}></span>
                          </span>
                        </label>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>Espectrómetro Principal</h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>Muestra barras musicales de fondo en la página principal.</p>

                          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                            <button
                              className={`btn ${largeSpectrumHeight === 'pequeno' ? '' : 'btn-outline'}`}
                              onClick={() => setLargeSpectrumHeight('pequeno')}
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >Pequeño</button>
                            <button
                              className={`btn ${largeSpectrumHeight === 'mediano' ? '' : 'btn-outline'}`}
                              onClick={() => setLargeSpectrumHeight('mediano')}
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >Mediano</button>
                            <button
                              className={`btn ${largeSpectrumHeight === 'alto' ? '' : 'btn-outline'}`}
                              onClick={() => setLargeSpectrumHeight('alto')}
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >Alto</button>
                          </div>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px' }}>
                          <input
                            type="checkbox"
                            checked={largeSpectrumEnabled}
                            onChange={(e) => setLargeSpectrumEnabled(e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: largeSpectrumEnabled ? 'var(--accent-color)' : 'var(--border-light)',
                            borderRadius: '20px', transition: '0.2s'
                          }}>
                            <span style={{
                              position: 'absolute', content: '""', height: '14px', width: '14px',
                              left: largeSpectrumEnabled ? '19px' : '3px', bottom: '3px',
                              backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                            }}></span>
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. SECCIÓN: MODO ZEN & AUDIO */}
                {(settingsCategory === 'zen' || settingsCategory === 'all') && (
                  <div style={{ marginBottom: '28px' }}>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '4px' }}>Comportamiento de Audio</h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>Suavizado de Reproducción</h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>Aplica un fundido rápido (como fade-in/fade-out) al iniciar o pausar la música.</p>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px' }}>
                          <input
                            type="checkbox"
                            checked={smoothFade}
                            onChange={(e) => setSmoothFade(e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: smoothFade ? 'var(--accent-color)' : 'var(--border-light)',
                            borderRadius: '20px', transition: '0.2s'
                          }}>
                            <span style={{
                              position: 'absolute', content: '""', height: '14px', width: '14px',
                              left: smoothFade ? '19px' : '3px', bottom: '3px',
                              backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                            }}></span>
                          </span>
                        </label>
                      </div>
                    </div>

                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px' }}>Modo Reposo (Zen Mode)</h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Sparkles size={16} style={{ color: 'var(--accent-color)' }} /> Modo Reposo (Zen Mode)
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>
                            Oculta la interfaz y activa una vista cinematográfica con visualizador reactivo tras inactividad.
                          </p>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={idleModeEnabled}
                            onChange={(e) => setIdleModeEnabled(e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: idleModeEnabled ? 'var(--accent-color)' : 'var(--border-light)',
                            borderRadius: '20px', transition: '0.2s'
                          }}>
                            <span style={{
                              position: 'absolute', content: '""', height: '14px', width: '14px',
                              left: idleModeEnabled ? '19px' : '3px', bottom: '3px',
                              backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                            }}></span>
                          </span>
                        </label>
                      </div>

                      {idleModeEnabled && (
                        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          {/* Customizador Preciso de Tiempo */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)' }}>Tiempo de Espera de Inactividad:</span>
                              <span style={{ fontSize: '12px', color: 'var(--accent-color)', fontWeight: 600 }}>
                                {idleTimeoutSeconds >= 60 ? `${Math.floor(idleTimeoutSeconds / 60)}m ${idleTimeoutSeconds % 60 > 0 ? `${idleTimeoutSeconds % 60}s` : ''}` : `${idleTimeoutSeconds}s`}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                              <input
                                type="range"
                                min="5"
                                max="300"
                                step="5"
                                value={idleTimeoutSeconds}
                                onChange={(e) => setIdleTimeoutSeconds(Math.max(5, parseInt(e.target.value, 10) || 5))}
                                className="zen-slider"
                                style={{ flex: 1 }}
                              />
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                <input
                                  type="number"
                                  min="5"
                                  max="600"
                                  value={idleTimeoutSeconds}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val)) setIdleTimeoutSeconds(Math.max(5, Math.min(600, val)));
                                  }}
                                  style={{
                                    width: '54px',
                                    padding: '3px 6px',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px',
                                    color: 'var(--text-highlight)',
                                    fontSize: '11px',
                                    textAlign: 'center'
                                  }}
                                />
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>seg</span>
                              </div>
                            </div>

                            {/* Chips rápidos */}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              {[10, 15, 30, 60, 120, 300].map(time => (
                                <button
                                  key={time}
                                  className={`btn ${idleTimeoutSeconds === time ? '' : 'btn-outline'}`}
                                  onClick={() => setIdleTimeoutSeconds(time)}
                                  style={{ padding: '3px 8px', fontSize: '10px' }}
                                >
                                  {time < 60 ? `${time}s` : `${time / 60}m`}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Modalidades Estéticas del Modo Zen */}
                          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)', display: 'block', marginBottom: '8px' }}>
                              Estilo Visual del Espectro:
                            </span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                              {[
                                { id: 'bars', label: 'Barras Centrales', desc: 'Espectro de barras', icon: Activity },
                                { id: 'wave', label: 'Onda Fluida', desc: 'Reflejo senoidal suave', icon: Waves },
                                { id: 'orbit', label: 'Aura Orbital', desc: 'Rayos 360° en torno al arte', icon: Sparkles },
                                { id: 'ambient', label: 'Resplandor Zen', desc: 'Pulso atmosférico', icon: Radio },
                              ].map(item => {
                                const Icon = item.icon;
                                const isActive = zenVisualMode === item.id;
                                return (
                                  <div
                                    key={item.id}
                                    className={`zen-mode-card ${isActive ? 'active' : ''}`}
                                    onClick={() => setZenVisualMode(item.id)}
                                  >
                                    <Icon size={20} style={{ color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)' }} />
                                    <span style={{ fontWeight: 600, fontSize: '12px' }}>{item.label}</span>
                                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{item.desc}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Configuraciones Estéticas Adicionales */}
                          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)' }}>
                              Ajustes Estéticos Avanzados:
                            </span>

                            {/* Intensidad de Desenfoque */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Desenfoque de fondo:</span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                {[
                                  { id: 'none', label: 'Negro Puro' },
                                  { id: 'soft', label: 'Suave' },
                                  { id: 'deep', label: 'Profundo' },
                                  { id: 'ultra', label: 'Inmersivo' },
                                ].map(b => (
                                  <button
                                    key={b.id}
                                    className={`btn ${zenBlurIntensity === b.id ? '' : 'btn-outline'}`}
                                    onClick={() => setZenBlurIntensity(b.id)}
                                    style={{ padding: '3px 8px', fontSize: '10px' }}
                                  >
                                    {b.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Opacidad del visualizador */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Opacidad del efecto:</span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                {[0.2, 0.4, 0.6, 0.8, 1.0].map(op => (
                                  <button
                                    key={op}
                                    className={`btn ${zenVisualOpacity === op ? '' : 'btn-outline'}`}
                                    onClick={() => setZenVisualOpacity(op)}
                                    style={{ padding: '3px 8px', fontSize: '10px' }}
                                  >
                                    {Math.round(op * 100)}%
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Micropulso de portada */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Micropulso reactivo en la portada:</span>
                              <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                <input
                                  type="checkbox"
                                  checked={zenCoverPulse}
                                  onChange={(e) => setZenCoverPulse(e.target.checked)}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: zenCoverPulse ? 'var(--accent-color)' : 'var(--border-light)',
                                  borderRadius: '18px', transition: '0.2s'
                                }}>
                                  <span style={{
                                    position: 'absolute', content: '""', height: '12px', width: '12px',
                                    left: zenCoverPulse ? '17px' : '3px', bottom: '3px',
                                    backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                  }}></span>
                                </span>
                              </label>
                            </div>

                            {/* Mostrar información de canción */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Mostrar título, artista y álbum:</span>
                              <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                <input
                                  type="checkbox"
                                  checked={zenShowDetails}
                                  onChange={(e) => setZenShowDetails(e.target.checked)}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: zenShowDetails ? 'var(--accent-color)' : 'var(--border-light)',
                                  borderRadius: '18px', transition: '0.2s'
                                }}>
                                  <span style={{
                                    position: 'absolute', content: '""', height: '12px', width: '12px',
                                    left: zenShowDetails ? '17px' : '3px', bottom: '3px',
                                    backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                  }}></span>
                                </span>
                              </label>
                            </div>

                            {/* Visualizador de Avance y Reproducción */}
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Activity size={14} style={{ color: 'var(--accent-color)' }} /> Avance y Reproducción en Pantalla:
                                </span>
                                <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                  <input
                                    type="checkbox"
                                    checked={zenProgressEnabled}
                                    onChange={(e) => setZenProgressEnabled(e.target.checked)}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                  />
                                  <span style={{
                                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: zenProgressEnabled ? 'var(--accent-color)' : 'var(--border-light)',
                                    borderRadius: '18px', transition: '0.2s'
                                  }}>
                                    <span style={{
                                      position: 'absolute', content: '""', height: '12px', width: '12px',
                                      left: zenProgressEnabled ? '17px' : '3px', bottom: '3px',
                                      backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                    }}></span>
                                  </span>
                                </label>
                              </div>

                              {zenProgressEnabled && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '2px' }}>
                                  {/* Estilo visual de avance */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Modo visual de avance:</span>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {[
                                        { id: 'bar', label: 'Barra Flotante' },
                                        { id: 'screen', label: 'Línea de Pantalla' },
                                        { id: 'ring', label: 'Anillo Orbital' }
                                      ].map(m => (
                                        <button
                                          key={m.id}
                                          className={`btn ${zenProgressMode === m.id ? '' : 'btn-outline'}`}
                                          onClick={() => setZenProgressMode(m.id)}
                                          style={{ padding: '3px 8px', fontSize: '10px' }}
                                        >
                                          {m.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Cronometraje */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Visualización de cronometraje:</span>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {[
                                        { id: 'both', label: 'Actual / Total' },
                                        { id: 'current', label: 'Solo Actual' },
                                        { id: 'remaining', label: 'Restante' },
                                        { id: 'percent', label: 'Porcentaje %' },
                                        { id: 'none', label: 'Sin Cronómetro' }
                                      ].map(t => (
                                        <button
                                          key={t.id}
                                          className={`btn ${zenProgressTiming === t.id ? '' : 'btn-outline'}`}
                                          onClick={() => setZenProgressTiming(t.id)}
                                          style={{ padding: '3px 8px', fontSize: '10px' }}
                                        >
                                          {t.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Resplandor neón reactivo */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Resplandor reactivo (Glow):</span>
                                    <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                      <input
                                        type="checkbox"
                                        checked={zenProgressGlow}
                                        onChange={(e) => setZenProgressGlow(e.target.checked)}
                                        style={{ opacity: 0, width: 0, height: 0 }}
                                      />
                                      <span style={{
                                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                        backgroundColor: zenProgressGlow ? 'var(--accent-color)' : 'var(--border-light)',
                                        borderRadius: '18px', transition: '0.2s'
                                      }}>
                                        <span style={{
                                          position: 'absolute', content: '""', height: '12px', width: '12px',
                                          left: zenProgressGlow ? '17px' : '3px', bottom: '3px',
                                          backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                        }}></span>
                                      </span>
                                    </label>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Reloj en Pantalla */}
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Clock size={14} style={{ color: 'var(--accent-color)' }} /> Reloj en Pantalla:
                                </span>
                                <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                  <input
                                    type="checkbox"
                                    checked={zenClockEnabled}
                                    onChange={(e) => setZenClockEnabled(e.target.checked)}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                  />
                                  <span style={{
                                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: zenClockEnabled ? 'var(--accent-color)' : 'var(--border-light)',
                                    borderRadius: '18px', transition: '0.2s'
                                  }}>
                                    <span style={{
                                      position: 'absolute', content: '""', height: '12px', width: '12px',
                                      left: zenClockEnabled ? '17px' : '3px', bottom: '3px',
                                      backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                    }}></span>
                                  </span>
                                </label>
                              </div>

                              {zenClockEnabled && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '2px' }}>
                                  {/* Posición en Pantalla */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Ubicación en pantalla:</span>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {[
                                        { id: 'top-right', label: 'Sup. Derecha' },
                                        { id: 'top-center', label: 'Sup. Centro' },
                                        { id: 'top-left', label: 'Sup. Izquierda' },
                                        { id: 'bottom-left', label: 'Inf. Izquierda' },
                                        { id: 'bottom-right', label: 'Inf. Derecha' },
                                        { id: 'above-cover', label: 'Sobre Portada' },
                                      ].map(pos => (
                                        <button
                                          key={pos.id}
                                          className={`btn ${zenClockPosition === pos.id ? '' : 'btn-outline'}`}
                                          onClick={() => setZenClockPosition(pos.id)}
                                          style={{ padding: '3px 8px', fontSize: '10px' }}
                                        >
                                          {pos.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Formato de Hora */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Formato de hora:</span>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      {[
                                        { id: '24h', label: '24 Horas' },
                                        { id: '12h', label: '12 Horas (AM/PM)' },
                                      ].map(f => (
                                        <button
                                          key={f.id}
                                          className={`btn ${zenClockFormat === f.id ? '' : 'btn-outline'}`}
                                          onClick={() => setZenClockFormat(f.id)}
                                          style={{ padding: '3px 8px', fontSize: '10px' }}
                                        >
                                          {f.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Estilo Visual */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Estilo visual:</span>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {[
                                        { id: 'minimal', label: 'Minimalista' },
                                        { id: 'glass', label: 'Glassmorphism' },
                                        { id: 'accent', label: 'Acento Neón' },
                                        { id: 'bold', label: 'Negrita Fuerte' },
                                      ].map(st => (
                                        <button
                                          key={st.id}
                                          className={`btn ${zenClockStyle === st.id ? '' : 'btn-outline'}`}
                                          onClick={() => setZenClockStyle(st.id)}
                                          style={{ padding: '3px 8px', fontSize: '10px' }}
                                        >
                                          {st.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Toggles: Segundos y Fecha */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Mostrar segundos:</span>
                                    <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                      <input
                                        type="checkbox"
                                        checked={zenClockShowSeconds}
                                        onChange={(e) => setZenClockShowSeconds(e.target.checked)}
                                        style={{ opacity: 0, width: 0, height: 0 }}
                                      />
                                      <span style={{
                                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                        backgroundColor: zenClockShowSeconds ? 'var(--accent-color)' : 'var(--border-light)',
                                        borderRadius: '18px', transition: '0.2s'
                                      }}>
                                        <span style={{
                                          position: 'absolute', content: '""', height: '12px', width: '12px',
                                          left: zenClockShowSeconds ? '17px' : '3px', bottom: '3px',
                                          backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                        }}></span>
                                      </span>
                                    </label>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Mostrar fecha del día:</span>
                                    <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                      <input
                                        type="checkbox"
                                        checked={zenClockShowDate}
                                        onChange={(e) => setZenClockShowDate(e.target.checked)}
                                        style={{ opacity: 0, width: 0, height: 0 }}
                                      />
                                      <span style={{
                                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                        backgroundColor: zenClockShowDate ? 'var(--accent-color)' : 'var(--border-light)',
                                        borderRadius: '18px', transition: '0.2s'
                                      }}>
                                        <span style={{
                                          position: 'absolute', content: '""', height: '12px', width: '12px',
                                          left: zenClockShowDate ? '17px' : '3px', bottom: '3px',
                                          backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                        }}></span>
                                      </span>
                                    </label>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. SECCIÓN: MINI-REPRODUCTOR FLOTANTE */}
                {(settingsCategory === 'pip' || settingsCategory === 'all') && (
                  <div style={{ marginBottom: '28px' }}>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '4px' }}>
                      Mini-Reproductor Flotante «Siempre Visible»
                    </h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      {/* Fila principal: Toggle de activación */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <PictureInPicture2 size={16} style={{ color: 'var(--accent-color)' }} /> Mini-Reproductor Flotante «Siempre Visible»
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, maxWidth: '580px', lineHeight: 1.4 }}>
                            Desprende la reproducción en una mini-ventana nativa del sistema operativo que permanece siempre por encima de tus aplicaciones y juegos.
                          </p>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={pipEnabled}
                            onChange={(e) => {
                              const val = e.target.checked;
                              setPipEnabled(val);
                              try { localStorage.setItem('musicPlayer_pipEnabled', JSON.stringify(val)); } catch (err) {}
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: pipEnabled ? 'var(--accent-color)' : 'var(--border-light)',
                            borderRadius: '20px', transition: '0.2s'
                          }}>
                            <span style={{
                              position: 'absolute', content: '""', height: '14px', width: '14px',
                              left: pipEnabled ? '19px' : '3px', bottom: '3px',
                              backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                            }}></span>
                          </span>
                        </label>
                      </div>

                      {/* Sub-panel de opciones avanzadas cuando está habilitado */}
                      {pipEnabled && (
                        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          
                          {/* 1. Estado actual y botón de lanzamiento manual */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-highlight)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: pipActive ? '#10b981' : 'var(--text-secondary)' }}></span>
                                <span>{pipActive ? 'Mini-Reproductor actualmente abierto en pantalla' : 'Ventana flotante actualmente cerrada'}</span>
                              </div>
                              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                                {pipActive ? 'La mini-ventana está activa sobre tu escritorio y sincronizada en tiempo real.' : 'Puedes abrirla en cualquier momento o permitir que se active automáticamente.'}
                              </p>
                            </div>
                            <button
                              className={`btn ${pipActive ? 'btn-outline' : ''}`}
                              onClick={togglePiP}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '12px',
                                padding: '6px 14px',
                                ...(pipActive ? { color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' } : {})
                              }}
                            >
                              <PictureInPicture2 size={14} />
                              {pipActive ? 'Cerrar Mini-Reproductor' : 'Abrir Mini-Reproductor'}
                            </button>
                          </div>

                          {/* 2. Dimensiones de la ventana (tarjetas grandes idénticas a Estilo Visual del Modo Zen) */}
                          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '16px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)', display: 'block', marginBottom: '4px' }}>
                              Dimensiones de la Ventana Flotante:
                            </span>
                            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
                              Selecciona las proporciones ideales para tu flujo de trabajo o monitor.
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                              {[
                                { id: 'compact', label: 'Compacto', dim: '330 × 150 px', desc: 'Discreto y minimalista', icon: Minimize2 },
                                { id: 'standard', label: 'Estándar', dim: '380 × 185 px', desc: 'Equilibrado (Recomendado)', icon: Layout },
                                { id: 'expanded', label: 'Expandido', dim: '440 × 220 px', desc: 'Máxima legibilidad', icon: Maximize2 },
                              ].map(opt => {
                                const Icon = opt.icon;
                                const isActive = pipSize === opt.id;
                                return (
                                  <div
                                    key={opt.id}
                                    className={`zen-mode-card ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                      setPipSize(opt.id);
                                      try { localStorage.setItem('musicPlayer_pipSize', opt.id); } catch (err) {}
                                    }}
                                  >
                                    <Icon size={20} style={{ color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)' }} />
                                    <span style={{ fontWeight: 600, fontSize: '12px' }}>{opt.label}</span>
                                    <span style={{ fontSize: '11px', color: isActive ? 'var(--accent-color)' : 'var(--text-highlight)', fontWeight: 500 }}>{opt.dim}</span>
                                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{opt.desc}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* 3. Opciones con Toggles finos idénticos a Zen */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {/* Apertura Automática */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)' }}>Apertura Automática en Segundo Plano</span>
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                                  Abre automáticamente el mini-reproductor si minimizas o cambias de pestaña mientras hay música sonando.
                                </p>
                              </div>
                              <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', flexShrink: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={pipAutoOpen}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setPipAutoOpen(val);
                                    try { localStorage.setItem('musicPlayer_pipAutoOpen', JSON.stringify(val)); } catch (err) {}
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: pipAutoOpen ? 'var(--accent-color)' : 'var(--border-light)',
                                  borderRadius: '18px', transition: '0.2s'
                                }}>
                                  <span style={{
                                    position: 'absolute', content: '""', height: '12px', width: '12px',
                                    left: pipAutoOpen ? '17px' : '3px', bottom: '3px',
                                    backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                  }}></span>
                                </span>
                              </label>
                            </div>

                            {/* Onda Reactiva / Mini Espectro */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)' }}>Onda Musical Reactiva (Mini-Espectro)</span>
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                                  Muestra barritas animadas al ritmo del compás sobre la carátula durante la reproducción.
                                </p>
                              </div>
                              <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', flexShrink: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={pipShowSpectrum}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setPipShowSpectrum(val);
                                    try { localStorage.setItem('musicPlayer_pipShowSpectrum', JSON.stringify(val)); } catch (err) {}
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: pipShowSpectrum ? 'var(--accent-color)' : 'var(--border-light)',
                                  borderRadius: '18px', transition: '0.2s'
                                }}>
                                  <span style={{
                                    position: 'absolute', content: '""', height: '12px', width: '12px',
                                    left: pipShowSpectrum ? '17px' : '3px', bottom: '3px',
                                    backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                  }}></span>
                                </span>
                              </label>
                            </div>

                            {/* Barra de Progreso Interactiva */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)' }}>Barra de Progreso Interactiva</span>
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                                  Permite hacer clic o arrastrar en la barra de tiempo de la ventana flotante para adelantar o retroceder.
                                </p>
                              </div>
                              <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', flexShrink: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={pipInteractiveProgress}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setPipInteractiveProgress(val);
                                    try { localStorage.setItem('musicPlayer_pipInteractiveProgress', JSON.stringify(val)); } catch (err) {}
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: pipInteractiveProgress ? 'var(--accent-color)' : 'var(--border-light)',
                                  borderRadius: '18px', transition: '0.2s'
                                }}>
                                  <span style={{
                                    position: 'absolute', content: '""', height: '12px', width: '12px',
                                    left: pipInteractiveProgress ? '17px' : '3px', bottom: '3px',
                                    backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                  }}></span>
                                </span>
                              </label>
                            </div>

                            {/* Mostrar Nombre de Álbum */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-highlight)' }}>Mostrar Álbum de la Canción</span>
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                                  Muestra la etiqueta del álbum junto al artista en el encabezado de la mini-ventana flotante.
                                </p>
                              </div>
                              <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', flexShrink: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={pipShowAlbum}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setPipShowAlbum(val);
                                    try { localStorage.setItem('musicPlayer_pipShowAlbum', JSON.stringify(val)); } catch (err) {}
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: pipShowAlbum ? 'var(--accent-color)' : 'var(--border-light)',
                                  borderRadius: '18px', transition: '0.2s'
                                }}>
                                  <span style={{
                                    position: 'absolute', content: '""', height: '12px', width: '12px',
                                    left: pipShowAlbum ? '17px' : '3px', bottom: '3px',
                                    backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                                  }}></span>
                                </span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. SECCIÓN: TEMPORIZADOR DE APAGADO */}
                {(settingsCategory === 'timer' || settingsCategory === 'all') && (
                  <div style={{ marginBottom: '28px' }}>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '4px' }}>
                      Temporizador de Apagado
                    </h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Moon size={15} style={{ color: 'var(--accent-color)' }} /> Apagado Automático Programado
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, maxWidth: '540px', lineHeight: 1.4 }}>
                            Detiene la reproducción tras un tiempo fijado o tras un número determinado de canciones, con un desvanecimiento suave de volumen (5 segundos). Ideal para conciliar el sueño escuchando música.
                          </p>
                        </div>
                        {sleepTimer.active && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              padding: '6px 12px',
                              background: 'color-mix(in srgb, var(--accent-color) 12%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--accent-color) 35%, transparent)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              color: 'var(--accent-color)',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}>
                              <Timer size={14} />
                              <span>
                                {sleepTimer.mode === 'time'
                                  ? `Apagado en ${formatSleepTime(sleepTimer.remainingSeconds)}`
                                  : `Apagado tras ${sleepTimer.remainingTracks} ${sleepTimer.remainingTracks === 1 ? 'canción' : 'canciones'}`}
                              </span>
                            </div>
                            <button
                              className="btn btn-outline"
                              onClick={cancelSleepTimer}
                              style={{ padding: '6px 12px', fontSize: '12px' }}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Pestañas modo settings */}
                      <div style={{
                        display: 'inline-flex',
                        width: 'fit-content',
                        gap: '6px',
                        background: 'var(--bg-tertiary)',
                        padding: '4px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)'
                      }}>
                        <button
                          className={`btn ${sleepSettingsTab === 'time' ? '' : 'btn-outline'}`}
                          onClick={() => setSleepSettingsTab('time')}
                          style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Clock size={13} />
                          <span>Por Tiempo</span>
                        </button>
                        <button
                          className={`btn ${sleepSettingsTab === 'tracks' ? '' : 'btn-outline'}`}
                          onClick={() => setSleepSettingsTab('tracks')}
                          style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Music size={13} />
                          <span>Por Canciones</span>
                        </button>
                      </div>

                      {sleepSettingsTab === 'time' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {[
                              { sec: 15 * 60, label: '15m' },
                              { sec: 30 * 60, label: '30m' },
                              { sec: 45 * 60, label: '45m' },
                              { sec: 60 * 60, label: '1 hora' },
                              { sec: 2 * 3600, label: '2 horas' },
                              { sec: 4 * 3600, label: '4 horas' },
                              { sec: 8 * 3600, label: '8 horas' },
                            ].map(preset => {
                              const isSelected = sleepTimer.active && sleepTimer.mode === 'time' && Math.abs((sleepTimer.remainingSeconds || 0) - preset.sec) < 5;
                              return (
                                <button
                                  key={preset.sec}
                                  onClick={() => activateSleepTimerByTime(preset.sec, preset.label)}
                                  className={`btn ${isSelected ? '' : 'btn-outline'}`}
                                  style={{ fontSize: '12px', padding: '6px 14px' }}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                            {sleepTimer.active && (
                              <button
                                onClick={cancelSleepTimer}
                                className="btn btn-outline"
                                style={{ fontSize: '12px', padding: '6px 14px', color: 'var(--text-secondary)' }}
                              >
                                Desactivar
                              </button>
                            )}
                          </div>

                          {/* Ajuste manual de tiempo */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Ajuste manual de tiempo:</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="number"
                                min="0"
                                max="23"
                                placeholder="0"
                                value={customSettingsHours}
                                onChange={e => setCustomSettingsHours(e.target.value)}
                                style={{ width: '50px', padding: '5px 8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', textAlign: 'center', fontSize: '12px' }}
                              />
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>h</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="number"
                                min="0"
                                max="59"
                                placeholder="30"
                                value={customSettingsMinutes}
                                onChange={e => setCustomSettingsMinutes(e.target.value)}
                                style={{ width: '50px', padding: '5px 8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', textAlign: 'center', fontSize: '12px' }}
                              />
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>m</span>
                            </div>
                            <button
                              className="btn"
                              style={{ fontSize: '12px', padding: '6px 14px' }}
                              onClick={() => {
                                const h = parseInt(customSettingsHours, 10) || 0;
                                const m = parseInt(customSettingsMinutes, 10) || 0;
                                const totalSecs = (h * 3600) + (m * 60);
                                if (totalSecs > 0) {
                                  activateSleepTimerByTime(totalSecs, `${h > 0 ? `${h}h ` : ''}${m}m`);
                                }
                              }}
                            >
                              Activar Temporizador
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {[
                              { tracks: 1, label: 'Fin de canción actual' },
                              { tracks: 2, label: '2 canciones' },
                              { tracks: 3, label: '3 canciones' },
                              { tracks: 5, label: '5 canciones' },
                              { tracks: 10, label: '10 canciones' },
                            ].map(preset => {
                              const isSelected = sleepTimer.active && sleepTimer.mode === 'tracks' && sleepTimer.remainingTracks === preset.tracks;
                              return (
                                <button
                                  key={preset.tracks}
                                  onClick={() => activateSleepTimerByTracks(preset.tracks)}
                                  className={`btn ${isSelected ? '' : 'btn-outline'}`}
                                  style={{ fontSize: '12px', padding: '6px 14px' }}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                            {sleepTimer.active && (
                              <button
                                onClick={cancelSleepTimer}
                                className="btn btn-outline"
                                style={{ fontSize: '12px', padding: '6px 14px', color: 'var(--text-secondary)' }}
                              >
                                Desactivar
                              </button>
                            )}
                          </div>

                          {/* Ajuste manual de canciones */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Cantidad manual de canciones:</span>
                            <input
                              type="number"
                              min="1"
                              max="999"
                              placeholder="Ej: 7"
                              value={customSettingsTracks}
                              onChange={e => setCustomSettingsTracks(e.target.value)}
                              style={{ width: '80px', padding: '5px 8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', textAlign: 'center', fontSize: '12px' }}
                            />
                            <button
                              className="btn"
                              style={{ fontSize: '12px', padding: '6px 14px' }}
                              onClick={() => {
                                const val = parseInt(customSettingsTracks, 10);
                                if (val > 0) {
                                  activateSleepTimerByTracks(val);
                                }
                              }}
                            >
                              Activar Temporizador
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Configuración de Pantalla Nocturna al terminar el temporizador */}
                      <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Moon size={14} style={{ color: 'var(--accent-color)' }} /> Modo de Pantalla Nocturna (Al Apagar)
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '11.5px', margin: 0, lineHeight: 1.4 }}>
                            Define qué ocurre visualmente al completarse el temporizador. Cualquier tecla, clic o toque despierta la pantalla inmediatamente.
                          </p>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                          {[
                            { id: 'clock', title: 'Reloj Nocturno', desc: 'Pantalla negra OLED con el reloj en el centro como último acompañante.', icon: Clock },
                            { id: 'black', title: 'Pantalla Negra Total', desc: 'Oscuridad absoluta y apagado visual completo para máxima desconexión.', icon: Moon },
                            { id: 'none', title: 'Solo Pausar la Música', desc: 'Detiene el audio pero mantiene la interfaz normal del reproductor.', icon: VolumeX }
                          ].map(opt => {
                            const isSelected = sleepTimerEndAction === opt.id;
                            const IconComp = opt.icon;
                            return (
                              <div
                                key={opt.id}
                                onClick={() => setSleepTimerEndAction(opt.id)}
                                style={{
                                  padding: '12px 14px',
                                  borderRadius: '8px',
                                  border: `1.5px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                                  background: isSelected ? 'color-mix(in srgb, var(--accent-color) 10%, var(--bg-tertiary))' : 'var(--bg-tertiary)',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '12.5px', color: isSelected ? 'var(--text-highlight)' : 'var(--text-primary)' }}>
                                    <IconComp size={14} style={{ color: isSelected ? 'var(--accent-color)' : 'var(--text-secondary)' }} />
                                    <span>{opt.title}</span>
                                  </div>
                                  <div style={{
                                    width: '14px',
                                    height: '14px',
                                    borderRadius: '50%',
                                    border: `2px solid ${isSelected ? 'var(--accent-color)' : 'var(--text-secondary)'}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                  }}>
                                    {isSelected && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }}></div>}
                                  </div>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                  {opt.desc}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* TIEMPO DE DESVANECIMIENTO SUAVE (FADE-OUT) */}
                      <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Waves size={14} style={{ color: 'var(--accent-color)' }} /> Tiempo de Desvanecimiento Suave (Fade-Out)
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '11.5px', margin: 0, lineHeight: 1.4 }}>
                            Duración de la atenuación progresiva del volumen antes de que el temporizador detenga la música por completo. Permite conciliar el sueño sin cortes abruptos.
                          </p>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {[
                            { secs: 0, label: '0s (Inmediato)' },
                            { secs: 3, label: '3s' },
                            { secs: 5, label: '5s (Recomendado)' },
                            { secs: 10, label: '10s' },
                            { secs: 15, label: '15s' },
                            { secs: 30, label: '30s' }
                          ].map(item => {
                            const isSelected = sleepTimerFadeSeconds === item.secs;
                            return (
                              <button
                                key={item.secs}
                                type="button"
                                onClick={() => setSleepTimerFadeSeconds(item.secs)}
                                style={{
                                  padding: '7px 14px',
                                  borderRadius: '6px',
                                  border: `1.5px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                                  background: isSelected ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                  color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                                  fontWeight: isSelected ? 600 : 400,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {item.label}
                              </button>
                            );
                          })}

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
                            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Personalizado:</span>
                            <input
                              type="number"
                              min="0"
                              max="120"
                              value={sleepTimerFadeSeconds}
                              onChange={(e) => {
                                const val = Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0));
                                setSleepTimerFadeSeconds(val);
                              }}
                              style={{
                                width: '56px',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-highlight)',
                                fontSize: '12px',
                                textAlign: 'center'
                              }}
                            />
                            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>seg</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. SECCIÓN: ATAJOS DE TECLADO */}
                {(settingsCategory === 'hotkeys' || settingsCategory === 'all') && (
                  <div style={{ marginBottom: '28px' }}>
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '4px' }}>Atajos de Teclado</h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '8px' }}>Haz clic en un atajo para cambiarlo. Presiona Esc para cancelar.</p>
                      {[
                        { id: 'playPause', label: 'Reproducir / Pausar' },
                        { id: 'stop', label: 'Detener por completo' },
                        { id: 'prevTrack', label: 'Pista Anterior' },
                        { id: 'nextTrack', label: 'Siguiente Pista' },
                        { id: 'rewind', label: 'Retroceder 5s' },
                        { id: 'forward', label: 'Adelantar 5s' },
                        { id: 'volDown', label: 'Bajar Volumen' },
                        { id: 'volUp', label: 'Subir Volumen' },
                        { id: 'mute', label: 'Silenciar / Des-silenciar' },
                        { id: 'favorite', label: 'Favorito (Añadir / Quitar)' },
                        { id: 'random', label: 'Modo Aleatorio' },
                        { id: 'repeat', label: 'Modo Repetición' },
                        { id: 'fullscreen', label: 'Pantalla Completa' },
                        { id: 'search', label: 'Búsqueda Instantánea' },
                        { id: 'clearSearch', label: 'Limpiar / Desenfocar Búsqueda' }
                      ].map(action => (
                        <div key={action.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{action.label}</span>
                          <button
                            onClick={() => setEditingHotkey(action.id)}
                            onKeyDown={(e) => {
                              if (editingHotkey !== action.id) return;
                              e.preventDefault();
                              e.stopPropagation();
                              if (e.key === 'Escape' && action.id !== 'clearSearch') {
                                setEditingHotkey(null);
                                return;
                              }
                              const mods = [];
                              if (e.ctrlKey) mods.push('Ctrl');
                              if (e.altKey) mods.push('Alt');
                              if (e.shiftKey) mods.push('Shift');
                              if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;

                              const keyName = e.code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
                              const fullKey = [...mods, keyName].join('+');
                              setHotkeys(prev => ({ ...prev, [action.id]: fullKey }));
                              setEditingHotkey(null);
                            }}
                            style={{
                              background: editingHotkey === action.id ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                              border: `1px solid ${editingHotkey === action.id ? 'var(--accent-color)' : 'var(--border-color)'}`,
                              color: editingHotkey === action.id ? '#fff' : 'var(--text-secondary)',
                              padding: '6px 12px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px',
                              minWidth: '120px',
                              textAlign: 'center'
                            }}
                          >
                            {editingHotkey === action.id ? 'Presiona una tecla...' : hotkeys[action.id]}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 6. SECCIÓN: SISTEMA & MANTENIMIENTO */}
                {(settingsCategory === 'system' || settingsCategory === 'all') && (
                  <div style={{ marginBottom: '28px' }}>
                    {/* 1. SUBSECCIÓN: BIBLIOTECA LOCAL Y ALMACENAMIENTO */}
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px', marginTop: '4px' }}>
                      Biblioteca Local y Almacenamiento
                    </h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-highlight)', fontSize: '14px', fontWeight: 600 }}>
                            <FolderOpen size={16} style={{ color: 'var(--accent-color)' }} />
                            <span>Biblioteca de Música</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {savedFolderInfo || isClonedToOPFS || songs.length > 0 ? (
                              <>Carpeta vinculada: <strong style={{ color: 'var(--text-highlight)' }}>"{savedFolderInfo?.name || 'Música Local'}"</strong></>
                            ) : (
                              'No hay ninguna carpeta vinculada actualmente.'
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: isClonedToOPFS ? '#10b981' : (songs.length > 0 ? '#f59e0b' : '#6b7280') }}></span>
                            {isClonedToOPFS ? (
                              <span style={{ color: '#10b981', fontWeight: 500 }}>
                                Almacenamiento Local Permanente Activo (OPFS) • {opfsTrackCount} canciones • 0 ms de arranque sin permisos
                              </span>
                            ) : (
                              songs.length > 0 ? (
                                <span style={{ color: '#f59e0b', fontWeight: 500 }}>
                                  Lectura desde disco • {songs.length} pistas catalogadas • No guardada en memoria local
                                </span>
                              ) : (
                                'Selecciona una carpeta física de música en tu equipo para comenzar a reproducir'
                              )
                            )}
                          </div>
                        </div>

                        {/* Botones de acción directos (Sin redundancias) */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {!isClonedToOPFS && songs.length > 0 && (
                            <button
                              className="btn"
                              onClick={handleCloneToStorage}
                              disabled={isScanning}
                              style={{ fontSize: '12px', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--accent-color)', color: '#fff' }}
                              title="Guardar archivos en la memoria local permanente del navegador para nunca más pedir permisos de lectura"
                            >
                              <Zap size={13} /> Guardar en Memoria Local ({songs.length} pistas)
                            </button>
                          )}
                          <button
                            className={(savedFolderInfo || isClonedToOPFS || songs.length > 0) ? 'btn btn-outline' : 'btn'}
                            onClick={handleSelectFolder}
                            disabled={isScanning}
                            style={{ fontSize: '12px', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
                            title="Seleccionar una carpeta de música desde tu equipo"
                          >
                            <FolderOpen size={13} /> {(savedFolderInfo || isClonedToOPFS || songs.length > 0) ? 'Cambiar Carpeta' : 'Seleccionar Carpeta'}
                          </button>
                          {(savedFolderInfo || isClonedToOPFS || songs.length > 0) && (
                            <button
                              className="btn btn-outline"
                              onClick={handleForgetSavedFolder}
                              disabled={isScanning}
                              style={{ fontSize: '12px', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                              title="Eliminar por completo la biblioteca y la memoria local de la aplicación"
                            >
                              <Trash2 size={13} /> Eliminar Biblioteca
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tarjetas informativas de estado limpias (Sin duplicar botones) */}
                      {!isClonedToOPFS && songs.length > 0 && (
                        <div style={{ padding: '12px 16px', backgroundColor: 'rgba(245, 158, 11, 0.08)', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.25)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Zap size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            <strong>¿Deseas arranque instantáneo sin pedir permisos?</strong> Utiliza el botón <strong>"Guardar en Memoria Local"</strong> para clonar tus pistas a la memoria privada del navegador (OPFS) y disfrutar de reproducción inmediata sin diálogos de permisos en cada sesión.
                          </span>
                        </div>
                      )}

                      {isClonedToOPFS && (
                        <div style={{ padding: '12px 16px', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.25)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <HardDrive size={16} color="#10b981" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            <strong>Memoria Local Permanente Activa:</strong> {opfsTrackCount} canciones guardadas de forma segura en el navegador ({storageInfo?.usageMB || 0} MB usados de {storageInfo?.quotaGB || 'N/A'} GB disponibles). Puedes reiniciar tu navegador cuando quieras, tu música sonará de inmediato sin diálogos ni ventanas.
                          </span>
                        </div>
                      )}

                      {isScanning && (
                        <div style={{ width: '100%', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                          <div className="progress-container">
                            <div className="progress-fill" style={{ width: `${scanProgress}%` }}></div>
                          </div>
                          {statusMessage && (
                            <div style={{ color: 'var(--accent-color)', fontSize: '11px', marginTop: '6px' }}>
                              {statusMessage}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 2. SUBSECCIÓN: APLICACIÓN Y PLATAFORMA */}
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px' }}>
                      Aplicación y Plataforma
                    </h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      {/* Instalabilidad PWA */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ maxWidth: '520px' }}>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Download size={15} style={{ color: 'var(--accent-color)' }} /> Instalabilidad Local como Aplicación de Escritorio
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                            Instala el reproductor como una aplicación nativa independiente en Windows. Ventana propia sin marcos de navegador, acceso directo en el escritorio y menú inicio, y respuesta a teclas multimedia de teclado.
                          </p>
                        </div>

                        <div>
                          {isInstalledPWA ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: 'color-mix(in srgb, var(--accent-color) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-color) 35%, transparent)', borderRadius: '6px', color: 'var(--accent-color)', fontSize: '12px', fontWeight: 600 }}>
                              <span>✓ Ejecutándose como App Nativa</span>
                            </div>
                          ) : deferredPrompt ? (
                            <button className="btn" onClick={handleInstallPWA} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '12px' }}>
                              <Download size={14} /> Instalar en el Sistema
                            </button>
                          ) : (
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                              Instalable desde el icono (+) de la barra del navegador
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Secretos del Sistema */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>Secretos del Sistema</h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>Habilita anomalías y "easter eggs" ocultos en la app.</p>
                        </div>
                        <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px' }}>
                          <input
                            type="checkbox"
                            checked={easterEggsEnabled}
                            onChange={(e) => {
                              const isEnabled = e.target.checked;
                              setEasterEggsEnabled(isEnabled);
                              if (!isEnabled) {
                                setEggMessage(":c");
                                setTimeout(() => setEggMessage(''), 2000);
                              } else {
                                setEggMessage(":D");
                                setTimeout(() => setEggMessage(''), 2000);
                              }
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span style={{
                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: easterEggsEnabled ? 'var(--accent-color)' : 'var(--border-light)',
                            borderRadius: '20px', transition: '0.2s'
                          }}>
                            <span style={{
                              position: 'absolute', content: '""', height: '14px', width: '14px',
                              left: easterEggsEnabled ? '19px' : '3px', bottom: '3px',
                              backgroundColor: 'var(--text-highlight)', borderRadius: '50%', transition: '0.2s'
                            }}></span>
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* SUBSECCIÓN: GESTIÓN DE DATOS Y RESPALDOS */}
                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px' }}>
                      Gestión de Datos y Respaldos
                    </h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      {/* Fila 1: Exportar Respaldo Global JSON */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ maxWidth: '480px' }}>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Share2 size={15} style={{ color: 'var(--accent-color)' }} /> Exportar Respaldo Completo (JSON)
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                            Descarga un archivo JSON con todas tus canciones favoritas ({favorites.length}), contadores de reproducciones, listas inteligentes personalizadas y preferencias de la app.
                          </p>
                        </div>
                        <button
                          className="btn"
                          onClick={exportGlobalBackup}
                          style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                          title="Descargar copia de seguridad en JSON"
                        >
                          <Download size={14} />
                          <span>Exportar Respaldo JSON</span>
                        </button>
                      </div>

                      {/* Fila 2: Importar Respaldo Global JSON */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ maxWidth: '480px' }}>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Upload size={15} style={{ color: 'var(--accent-color)' }} /> Importar y Restaurar Respaldo (JSON)
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                            Restaura tus favoritas, estadísticas y configuraciones desde un archivo JSON exportado previamente.
                          </p>
                        </div>
                        <div>
                          <input
                            type="file"
                            id="backup-json-input"
                            accept=".json,application/json"
                            style={{ display: 'none' }}
                            onChange={handleBackupFileSelect}
                          />
                          <button
                            className="btn btn-outline"
                            onClick={() => document.getElementById('backup-json-input')?.click()}
                            style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                            title="Seleccionar archivo JSON para restaurar"
                          >
                            <Upload size={14} />
                            <span>Cargar Respaldo JSON</span>
                          </button>
                        </div>
                      </div>

                      {/* Fila 3: Exportar Favoritas en M3U8 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                        <div style={{ maxWidth: '480px' }}>
                          <h4 style={{ color: 'var(--text-highlight)', margin: '0 0 4px 0', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={15} style={{ color: 'var(--accent-color)' }} /> Exportar Lista de Favoritas (M3U8)
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                            Exporta una lista de reproducción estándar M3U8 con tus {favorites.length} canciones favoritas para utilizar en cualquier otro reproductor externo (VLC, Winamp, Foobar2000, etc.).
                          </p>
                        </div>
                        <button
                          className="btn btn-outline"
                          onClick={exportFavoritesM3U8}
                          disabled={favorites.length === 0}
                          style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                          title="Descargar lista de reproducción M3U8"
                        >
                          <FileText size={14} />
                          <span>Exportar Favoritas (M3U8)</span>
                        </button>
                      </div>
                    </div>

                    <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '16px' }}>
                      Restablecimiento y Mantenimiento
                    </h3>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      {/* Botón 1: Restablecer todas las configuraciones */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                        <div style={{ maxWidth: '480px' }}>
                          <h4 style={{ color: 'var(--text-highlight)', marginBottom: '4px', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <RotateCcw size={15} style={{ color: 'var(--accent-color)' }} /> Restablecer Preferencias y Configuración
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>
                            Devuelve todos los ajustes estéticos, colores, modos zen y atajos a sus valores iniciales. Las canciones cargadas y tus listas se mantendrán intactas.
                          </p>
                        </div>
                        <button
                          className="btn btn-outline"
                          onClick={() => setShowResetConfigModal(true)}
                          style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                        >
                          <RotateCcw size={14} />
                          <span>Restablecer Preferencias</span>
                        </button>
                      </div>

                      <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }}></div>

                      {/* Botón 2: Restablecer la app completa */}
                      <div className="danger-box" style={{ padding: '16px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                        <div style={{ maxWidth: '480px' }}>
                          <h4 style={{ color: '#ef5350', marginBottom: '4px', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertTriangle size={15} /> Limpieza Total de la Aplicación
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>
                            Elimina todas las canciones cargadas, listas, cachés en memoria y datos guardados. Deja la aplicación como si se abriera por primera vez desde cero.
                          </p>
                        </div>
                        <button
                          className="btn btn-danger"
                          onClick={() => setShowResetAppModal(true)}
                          style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                        >
                          <Trash2 size={14} />
                          <span>Limpiar App Completa</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>

        {/* Mini Reproductor Flotante */}
        {activeTab !== 'library' && (
          <div
            className={`mini-now-playing ${activeSong ? 'visible' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            {activeSong && (
              <>
                <div className="audio-bars" title={globalIsPlaying ? "Reproduciendo" : "En pausa"}>
                  <div className="audio-bar" ref={el => liveBarsRef.current[0] = el}></div>
                  <div className="audio-bar" ref={el => liveBarsRef.current[1] = el}></div>
                  <div className="audio-bar" ref={el => liveBarsRef.current[2] = el}></div>
                  <div className="audio-bar" ref={el => liveBarsRef.current[3] = el}></div>
                </div>
                {activeSong.cover ? (
                  <img src={activeSong.cover} className="mini-np-cover" alt="" />
                ) : (
                  <div className="mini-np-cover" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Disc3 size={12} opacity={0.3} />
                  </div>
                )}
                <div className="mini-np-info">
                  <span className="mini-np-title">{activeSong.title}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '10px', margin: '0 4px' }}>•</span>
                  <span className="mini-np-artist">{activeSong.artist}</span>
                </div>
                <button
                  className={`heart-btn ${isSongFavorite(activeSong) ? 'is-fav' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(activeSong);
                  }}
                  title={isSongFavorite(activeSong) ? "Quitar de favoritos (L)" : "Añadir a favoritos (L)"}
                  style={{
                    marginLeft: 'auto',
                    padding: '6px',
                    borderRadius: '6px',
                    color: isSongFavorite(activeSong) ? '#f43f5e' : 'var(--text-secondary)',
                    flexShrink: 0
                  }}
                >
                  <Heart size={15} fill={isSongFavorite(activeSong) ? '#f43f5e' : 'none'} color={isSongFavorite(activeSong) ? '#f43f5e' : 'currentColor'} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <CustomPlayer
        src={currentAudioUrl}
        activeSong={activeSong}
        onNext={playNext}
        onPrev={playPrev}
        onStop={() => {
          if (currentAudioUrl) {
            URL.revokeObjectURL(currentAudioUrl);
            setCurrentAudioUrl(null);
          }
          setSelectedSong(null);
          setActiveSong(null);
          setPrevSong(null);
          setHighlightedSong(null);
          setGlobalIsPlaying(false);
        }}
        onPlayEmpty={(isRandom) => {
          if (displaySongs.length > 0) {
            let nextIndex = 0;
            if (isRandom) {
              nextIndex = Math.floor(Math.random() * displaySongs.length);
            }
            handleSelectSong(displaySongs[nextIndex], true);
          }
        }}
        onPlayStatusChange={setGlobalIsPlaying}
        liveBarsRef={liveBarsRef}
        pipLiveBarsRef={pipLiveBarsRef}
        largeCanvasRef={largeCanvasRef}
        largeSpectrumEnabled={largeSpectrumEnabled}
        prevSpectrumRef={prevSpectrumRef}
        zenCanvasRef={zenCanvasRef}
        zenCoverRef={zenCoverRef}
        zenPlaybackRefs={zenPlaybackRefs}
        zenVisualConfig={zenVisualConfig}
        isIdle={isIdle && !!activeSong}
        idleModeEnabled={idleModeEnabled}
        onToggleIdleMode={handleToggleIdleMode}
        pipAutoOpen={pipAutoOpen}
        onTogglePipAutoOpen={handleTogglePipAutoOpen}
        smoothFade={smoothFade}
        hotkeys={hotkeys}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        sleepTimer={sleepTimer}
        onActivateSleepTimerByTime={activateSleepTimerByTime}
        onActivateSleepTimerByTracks={activateSleepTimerByTracks}
        onCancelSleepTimer={cancelSleepTimer}
        onDecrementSleepTimerTracks={decrementSleepTimerTracks}
        onTickSleepTimerSeconds={tickSleepTimerSeconds}
        sleepTimerFadeSeconds={sleepTimerFadeSeconds}
        playQueue={playQueue}
        onRemoveFromQueue={removeFromQueue}
        onMoveQueueItem={moveQueueItem}
        onClearQueue={clearQueue}
        onPlayFromQueue={playFromQueue}
        onTogglePiP={togglePiP}
        pipActive={pipActive}
        pipEnabled={pipEnabled}
        onTimeProgress={handleTimeProgress}
      />

      {/* HUD DE VOLUMEN / MUTE FLOTANTE (EXCLUSIVO MODO ZEN) */}
      <VolumeHUD isZenMode={isIdle && !!activeSong} />

      {/* MODAL OVERLAY PARA LISTAS */}
      {modalData && (
        <div className="modal-overlay" onClick={() => setModalData(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{modalData.title} <span style={{ color: 'var(--text-secondary)', fontSize: '13px', marginLeft: '8px' }}>({modalData.items.length} resultados)</span></span>
              <X size={18} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setModalData(null)} />
            </div>
            <div className="modal-body">
              <div className="modal-list">
                {modalData.items.map(song => (
                  <div
                    key={song.id}
                    className={`modal-list-item clickable ${highlightedSong?.id === song.id ? 'selected' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setHighlightedSong(song)}
                    onContextMenu={(e) => handleSongContextMenu(e, song)}
                    onDoubleClick={() => {
                      setBaseList(modalData.items);
                      setPlaylistTitle(modalData.title);
                      setActiveTab('library');
                      setHighlightedSong(song);
                      handleSelectSong(song);
                      setModalData(null);
                    }}
                  >
                    {song.cover ? (
                      <img src={song.cover} alt="Cover" className="cover-thumb" style={{ width: '24px', height: '24px', objectFit: song.isSquareCover ? 'cover' : 'contain' }} />
                    ) : (
                      <div className="cover-thumb" style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Disc3 size={12} opacity={0.3} />
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                      <span style={{ color: 'var(--text-highlight)', fontSize: '13px' }}>{song.title}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{song.artist} • {song.album}</span>
                    </div>
                    <div style={{ color: 'var(--accent-color)', fontSize: '11px' }}>{song.year}</div>
                  </div>
                ))}
                {modalData.items.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>No hay canciones para mostrar.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ZEN MODE (IDLE) OVERLAY - ALTO RENDIMIENTO GPU */}
      <div
        className={`zen-mode-overlay ${isIdle && activeSong ? 'active' : ''}`}
        onClick={() => {
          if (isIdle) setIsIdle(false);
        }}
        onMouseMove={() => {
          setZenCursorVisible(true);
          if (zenCursorTimerRef.current) clearTimeout(zenCursorTimerRef.current);
          zenCursorTimerRef.current = setTimeout(() => {
            setZenCursorVisible(false);
          }, 2500);
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          backgroundColor: '#0a0a0c',
          opacity: isIdle && activeSong ? 1 : 0,
          pointerEvents: isIdle && activeSong ? 'auto' : 'none',
          transition: 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: isIdle && activeSong ? (zenCursorVisible ? 'default' : 'none') : 'default'
        }}
      >
        {activeSong && (
          <>
            {/* Fondo desenfocado aislado en memoria GPU */}
            {activeSong.cover && zenBlurIntensity !== 'none' && (
              <div
                className="zen-bg-layer"
                style={{
                  backgroundImage: `url(${activeSong.cover})`,
                  filter: zenBlurIntensity === 'soft' ? 'blur(35px) brightness(0.35)' :
                    zenBlurIntensity === 'ultra' ? 'blur(130px) brightness(0.25)' :
                      'blur(80px) brightness(0.30)'
                }}
              />
            )}

            {/* Visualizador de Espectro en Canvas de Alto Rendimiento */}
            <canvas
              ref={zenCanvasRef}
              className="zen-canvas"
              style={{ opacity: zenVisualOpacity }}
            />

            {/* RELOJ EN PANTALLA (CONFIGURABLE: POSICIONES FIJAS EN VIEWPORT) */}
            {zenClockEnabled && zenClockPosition !== 'above-cover' && (
              <ZenClock
                position={zenClockPosition}
                format={zenClockFormat}
                showSeconds={zenClockShowSeconds}
                showDate={zenClockShowDate}
                styleType={zenClockStyle}
              />
            )}

            {/* LÍNEA DE PROGRESO AL BORDE INFERIOR DE PANTALLA */}
            {zenProgressEnabled && zenProgressMode === 'screen' && (
              <div
                className="zen-progress-screen-bar"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
                  window.dispatchEvent(new CustomEvent('musicPlayer_seek', { detail: { percentage: pct } }));
                }}
                title="Buscar posición"
              >
                <div
                  ref={zenScreenBarRef}
                  className="zen-progress-screen-fill"
                  style={{
                    boxShadow: zenProgressGlow ? '0 0 14px var(--accent-color)' : 'none'
                  }}
                />
              </div>
            )}

            {/* Contenido: Portada estática con micropulso + Tipografía + Barra interactiva */}
            <div style={{ zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px', transform: 'translate3d(0,0,0)' }}>
              <div
                className="zen-cover-container"
                style={{
                  position: 'relative',
                  margin: (zenProgressEnabled && zenProgressMode === 'ring') ? '54px 0 64px 0' : '0',
                  transition: 'margin 0.3s ease'
                }}
              >
                {/* RELOJ SOBRE LA PORTADA (SIEMPRE REALMENTE POR ENCIMA DE LA PORTADA O ANILLO) */}
                {zenClockEnabled && zenClockPosition === 'above-cover' && (
                  <ZenClock
                    position="above-cover"
                    format={zenClockFormat}
                    showSeconds={zenClockShowSeconds}
                    showDate={zenClockShowDate}
                    styleType={zenClockStyle}
                    style={{
                      position: 'absolute',
                      bottom: (zenProgressEnabled && zenProgressMode === 'ring') ? 'calc(100% + 96px)' : 'calc(100% + 22px)',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 'max-content',
                      alignItems: 'center'
                    }}
                  />
                )}

                {/* ANILLO ORBITAL SVG (SI MODO ES 'ring') - ÓRBITA CIRCULAR COMPLETA ALREDEDOR DE LA PORTADA */}
                {zenProgressEnabled && zenProgressMode === 'ring' && (
                  <svg
                    style={{
                      position: 'absolute',
                      top: '-90px',
                      left: '-90px',
                      width: '520px',
                      height: '520px',
                      pointerEvents: 'none',
                      zIndex: 3,
                      transform: 'rotate(-90deg)'
                    }}
                  >
                    {/* Guía orbital celestial de fondo */}
                    <circle
                      cx="260"
                      cy="260"
                      r="252"
                      fill="transparent"
                      stroke="rgba(255, 255, 255, 0.08)"
                      strokeWidth="3"
                      strokeDasharray="4 6"
                    />
                    {/* Anillo de progreso reactivo */}
                    <circle
                      ref={zenRingRef}
                      cx="260"
                      cy="260"
                      r="252"
                      fill="transparent"
                      stroke="var(--accent-color)"
                      strokeWidth="3.5"
                      strokeDasharray={`${2 * Math.PI * 252}`}
                      strokeDashoffset={`${2 * Math.PI * 252}`}
                      strokeLinecap="round"
                      style={{
                        transition: 'stroke-dashoffset 0.1s linear',
                        filter: zenProgressGlow ? 'drop-shadow(0 0 10px var(--accent-color))' : 'none'
                      }}
                    />
                  </svg>
                )}

                <div ref={zenCoverRef} style={{ willChange: 'transform', transition: 'transform 0.08s ease-out' }}>
                  {activeSong.cover ? (
                    <img
                      src={activeSong.cover}
                      alt="Cover"
                      style={{
                        width: '340px',
                        height: '340px',
                        objectFit: activeSong.isSquareCover ? 'cover' : 'contain',
                        borderRadius: '24px',
                        boxShadow: '0 28px 70px rgba(0,0,0,0.85), 0 0 40px rgba(0,0,0,0.4)',
                        border: '1px solid rgba(255,255,255,0.12)'
                      }}
                    />
                  ) : (
                    <div style={{ width: '340px', height: '340px', borderRadius: '24px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 28px 70px rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Disc3 size={130} opacity={0.12} />
                    </div>
                  )}
                </div>
              </div>

              {zenShowDetails && (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '80vw' }}>
                  <h1 style={{ fontSize: '40px', fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '-0.02em', textShadow: '0 4px 20px rgba(0,0,0,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeSong.title}
                  </h1>
                  <h2 style={{ fontSize: '22px', fontWeight: 400, margin: 0, color: 'rgba(255,255,255,0.75)', textShadow: '0 2px 10px rgba(0,0,0,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeSong.artist}
                  </h2>
                  {activeSong.album && (
                    <h3 style={{ fontSize: '15px', fontWeight: 400, margin: 0, color: 'rgba(255,255,255,0.45)', textShadow: '0 2px 6px rgba(0,0,0,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeSong.album}
                    </h3>
                  )}
                </div>
              )}

              {/* BARRA FLOTANTE INTERACTIVA DE PROGRESO Y/O CRONOMETRAJE */}
              {zenProgressEnabled && (zenProgressMode === 'bar' || zenProgressTiming !== 'none') && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    width: '380px',
                    maxWidth: '90vw',
                    pointerEvents: 'auto'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {zenProgressMode === 'bar' && (
                    <div
                      className="zen-progress-bar-wrapper"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
                        window.dispatchEvent(new CustomEvent('musicPlayer_seek', { detail: { percentage: pct } }));
                      }}
                      title="Adelantar / Retroceder"
                    >
                      <div
                        ref={zenProgressBarRef}
                        className="zen-progress-fill-bar"
                        style={{
                          boxShadow: zenProgressGlow ? '0 0 14px var(--accent-color)' : 'none'
                        }}
                      />
                    </div>
                  )}

                  {zenProgressTiming !== 'none' && (
                    <div
                      ref={zenTimeRef}
                      style={{
                        fontSize: '13px',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'rgba(255, 255, 255, 0.65)',
                        letterSpacing: '0.04em',
                        fontWeight: 500,
                        textShadow: '0 2px 8px rgba(0,0,0,0.7)'
                      }}
                    >
                      0:00
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* TOAST DE NOTIFICACIÓN GLOBAL */}
      {(toastData || resetToastMessage) && (
        <div className={`app-toast-notification ${toastData?.isError ? 'toast-error' : ''} ${isToastExiting ? 'toast-exit' : ''}`}>
          {renderToastIcon(toastData || { message: resetToastMessage, icon: 'reset' })}
          <span>{toastData ? toastData.message : resetToastMessage}</span>
        </div>
      )}

      {/* MODAL PARA RESTABLECER PREFERENCIAS */}
      {showResetConfigModal && (
        <div className="modal-overlay" onClick={() => setShowResetConfigModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RotateCcw size={18} style={{ color: 'var(--accent-color)' }} />
                <span style={{ fontWeight: 600 }}>Restablecer Preferencias</span>
              </div>
              <X size={18} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowResetConfigModal(false)} />
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                ¿Deseas restaurar todas las opciones estéticas, colores, modos zen y atajos de teclado a sus valores iniciales predeterminados?
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                ✓ Tu biblioteca musical, canciones cargadas y listas de reproducción no se modificarán.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button className="btn btn-outline" onClick={() => setShowResetConfigModal(false)}>
                  Cancelar
                </button>
                <button className="btn" onClick={handleResetPreferences}>
                  Restablecer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA VACIADO COMPLETO DE LA APP */}
      {showResetAppModal && (
        <div className="modal-overlay" onClick={() => setShowResetAppModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '490px', border: '1px solid rgba(239, 83, 80, 0.4)' }}>
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239, 83, 80, 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef5350' }}>
                <AlertTriangle size={18} />
                <span style={{ fontWeight: 600 }}>Vaciado Completo de la Aplicación</span>
              </div>
              <X size={18} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowResetAppModal(false)} />
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                Esta acción eliminará <strong>todas las canciones importadas</strong>, listas, cachés en memoria y preferencias guardadas.
              </p>
              <p style={{ fontSize: '12px', color: '#ff6b6b', margin: 0, background: 'rgba(229, 57, 53, 0.08)', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(229, 57, 53, 0.2)' }}>
                El efecto será idéntico a abrir la app por primera vez en un entorno completamente limpio y vacío.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button className="btn btn-outline" onClick={() => setShowResetAppModal(false)}>
                  Cancelar
                </button>
                <button className="btn btn-danger" onClick={handleResetFullApp} style={{ backgroundColor: '#e53935', color: '#ffffff', borderColor: '#e53935' }}>
                  Limpiar Todo y Reiniciar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MENÚ CONTEXTUAL DINÁMICO POR CANCIÓN */}
      {contextMenu.visible && contextMenu.song && !isIdle && (
        <div
          className="custom-context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Encabezado del menú con información de la pista */}
          <div style={{
            padding: '6px 10px 8px 10px',
            borderBottom: '1px solid var(--border-color)',
            marginBottom: '4px'
          }}>
            <div style={{
              fontSize: '11.5px',
              fontWeight: 600,
              color: 'var(--text-highlight)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {contextMenu.song.title || contextMenu.song.filename}
            </div>
            <div style={{
              fontSize: '10px',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {contextMenu.song.artist || 'Artista Desconocido'}
            </div>
          </div>

          {/* Reproducir ahora */}
          <button
            className="context-menu-item"
            onClick={() => {
              handleSelectSong(contextMenu.song, true);
              setContextMenu({ visible: false, x: 0, y: 0, song: null });
            }}
          >
            <Play size={13} style={{ color: 'var(--accent-color)' }} />
            <span>Reproducir ahora</span>
          </button>

          {/* Reproducir siguiente (al inicio de la cola) */}
          <button
            className="context-menu-item"
            onClick={() => {
              addToQueueNext(contextMenu.song);
              setContextMenu({ visible: false, x: 0, y: 0, song: null });
            }}
          >
            <ArrowUp size={13} style={{ color: 'var(--accent-color)' }} />
            <span>Reproducir a continuación</span>
          </button>

          {/* Agregar a la cola (al final) */}
          <button
            className="context-menu-item"
            onClick={() => {
              addToQueueEnd(contextMenu.song);
              setContextMenu({ visible: false, x: 0, y: 0, song: null });
            }}
          >
            <ListOrdered size={13} style={{ color: 'var(--accent-color)' }} />
            <span>Añadir a la cola</span>
          </button>

          <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }}></div>

          {/* Favoritas toggle */}
          <button
            className="context-menu-item"
            onClick={() => {
              toggleFavorite(contextMenu.song);
              setContextMenu({ visible: false, x: 0, y: 0, song: null });
            }}
          >
            <Heart
              size={13}
              style={{
                color: isSongFavorite(contextMenu.song) ? '#ff4d6d' : 'var(--text-secondary)',
                fill: isSongFavorite(contextMenu.song) ? '#ff4d6d' : 'none'
              }}
            />
            <span>{isSongFavorite(contextMenu.song) ? 'Quitar de favoritas' : 'Marcar como favorita'}</span>
          </button>

          {/* Copiar información */}
          <button
            className="context-menu-item"
            onClick={() => {
              copySongInfo(contextMenu.song);
              setContextMenu({ visible: false, x: 0, y: 0, song: null });
            }}
          >
            <Copy size={13} style={{ color: 'var(--text-secondary)' }} />
            <span>Copiar título y artista</span>
          </button>
        </div>
      )}

      {/* MODAL PARA CONFIRMACIÓN DE IMPORTACIÓN DE RESPALDO GLOBAL */}
      {showImportModal && pendingImportData && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Upload size={18} style={{ color: 'var(--accent-color)' }} />
                <span style={{ fontWeight: 600 }}>Restaurar Respaldo Global</span>
              </div>
              <X size={18} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowImportModal(false)} />
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                Se ha detectado un archivo de respaldo generado el{' '}
                <strong>
                  {pendingImportData.exportedAt
                    ? new Date(pendingImportData.exportedAt).toLocaleString()
                    : 'Fecha no especificada'}
                </strong>.
              </p>

              <div style={{
                backgroundColor: 'var(--bg-tertiary)',
                padding: '14px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Canciones Favoritas:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-highlight)' }}>
                    {Array.isArray(pendingImportData.favorites) ? pendingImportData.favorites.length : 0} registradas
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Historial de Reproducciones:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-highlight)' }}>
                    {pendingImportData.playCounts ? Object.keys(pendingImportData.playCounts).length : 0} pistas contadas
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Listas Inteligentes Personalizadas:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-highlight)' }}>
                    {Array.isArray(pendingImportData.customSmartPlaylists) ? pendingImportData.customSmartPlaylists.length : 0}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ajustes & Preferencias:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-highlight)' }}>
                    {pendingImportData.settings ? 'Incluidos' : 'No presentes'}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Esta acción combinará y actualizará tus canciones favoritas, estadísticas de reproducciones y configuraciones visuales.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button className="btn btn-outline" onClick={() => setShowImportModal(false)}>
                  Cancelar
                </button>
                <button
                  className="btn"
                  onClick={applyGlobalBackup}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--accent-color)', color: '#fff' }}
                >
                  <Upload size={14} />
                  <span>Aplicar Respaldo</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY INTELIGENTE PARA ARRASTRAR Y SOLTAR (DRAG & DROP BUFFEADO) */}
      {isDraggingOver && (
        <div
          className="drag-drop-overlay"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => handleSmartDrop(e, 'library')}
        >
          <div className="drag-drop-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drag-pulse-icon">
              <Sparkles size={48} />
            </div>
            <div className="drag-drop-header">
              <h2>Suelta tus canciones o carpetas</h2>
              <p>Arrastra directamente a una de las zonas inteligentes de importación</p>
            </div>

            <div className="drag-drop-zones">
              <div
                className={`drag-zone-card ${dragTargetZone === 'library' ? 'active' : ''}`}
                onDragEnter={() => setDragTargetZone('library')}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => handleSmartDrop(e, 'library')}
              >
                <div className="drag-zone-icon">
                  <FolderOpen size={24} />
                </div>
                <h3>Añadir a la Biblioteca</h3>
                <p>Indexa permanentemente y conserva carátulas de carpeta</p>
              </div>

              <div
                className={`drag-zone-card ${dragTargetZone === 'queue' ? 'active' : ''}`}
                onDragEnter={() => setDragTargetZone('queue')}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => handleSmartDrop(e, 'queue')}
              >
                <div className="drag-zone-icon">
                  <ListMusic size={24} />
                </div>
                <h3>Añadir a la Cola</h3>
                <p>Carga a la lista activa para reproducción inmediata</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PORTAL DEL MINI-REPRODUCTOR FLOTANTE ("SIEMPRE VISIBLE") */}
      {pipActive && pipWindow && createPortal(
        <PipPlayerContent
          activeSong={activeSong}
          isPlaying={globalIsPlaying}
          currentTime={pipProgressData.currentTime}
          duration={pipProgressData.duration}
          progress={pipProgressData.progress}
          showSpectrum={pipShowSpectrum}
          showAlbum={pipShowAlbum}
          interactiveProgress={pipInteractiveProgress}
          isFavorite={activeSong ? isSongFavorite(activeSong) : false}
          onToggleFavorite={() => activeSong && toggleFavorite(activeSong)}
          onTogglePlay={() => window.dispatchEvent(new CustomEvent('musicPlayer_togglePlay'))}
          onStop={() => window.dispatchEvent(new CustomEvent('musicPlayer_stop'))}
          onForward={() => window.dispatchEvent(new CustomEvent('musicPlayer_forward'))}
          onRewind={() => window.dispatchEvent(new CustomEvent('musicPlayer_rewind'))}
          onToggleMute={() => window.dispatchEvent(new CustomEvent('musicPlayer_toggleMute'))}
          onVolumeChange={(deltaY, step = 1) => window.dispatchEvent(new CustomEvent('musicPlayer_wheelVolume', { detail: { deltaY, step } }))}
          onNext={playNext}
          onPrev={playPrev}
          onSeek={(percentage) => window.dispatchEvent(new CustomEvent('musicPlayer_seek', { detail: { percentage } }))}
          onClose={closePiP}
          pipLiveBarsRef={pipLiveBarsRef}
          hotkeys={hotkeys}
        />,
        pipWindow.document.body
      )}

      {/* PANTALLA NOCTURNA DE APAGADO (STANDBY NOCTURNO) */}
      {isSleepStandbyActive && (
        <div
          className="sleep-standby-overlay"
          onClick={() => setIsSleepStandbyActive(false)}
          tabIndex={0}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: '#000000',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          {sleepTimerEndAction === 'clock' && (
            <div
              className="sleep-standby-clock"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <ZenClock
                position="center"
                format={zenClockFormat}
                showSeconds={false}
                showDate={zenClockShowDate}
                styleType={zenClockStyle}
              />
              <div
                style={{
                  marginTop: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#64748b',
                  fontSize: '12px',
                  letterSpacing: '0.04em',
                  opacity: 0.6
                }}
              >
                <Moon size={14} style={{ color: 'var(--accent-color)' }} />
                <span>Buenas noches • Toca cualquier tecla o haz clic para despertar</span>
              </div>
            </div>
          )}

          {sleepTimerEndAction === 'black' && (
            <div
              style={{
                position: 'absolute',
                bottom: '28px',
                color: '#475569',
                fontSize: '11px',
                letterSpacing: '0.05em',
                opacity: 0.3
              }}
            >
              Toca o presiona cualquier tecla para despertar
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
