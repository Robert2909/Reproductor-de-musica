// Persistencia de directorio con File System Access API e IndexedDB + localStorage
const DB_NAME = 'reproductor_musica_db';
const DB_VERSION = 4;
const STORE_NAME = 'handles';
const META_STORE_NAME = 'library_meta';

let cachedDB = null;

function openDB() {
  if (cachedDB) {
    try {
      // Verificar si la conexión sigue abierta
      if (cachedDB.objectStoreNames) {
        return Promise.resolve(cachedDB);
      }
    } catch (e) {
      cachedDB = null;
    }
  }

  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      resolve(null);
      return;
    }
    try {
      const timer = setTimeout(() => {
        console.warn('Timeout abriendo IndexedDB (fallback activado)');
        resolve(null);
      }, 3000);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(META_STORE_NAME)) {
          db.createObjectStore(META_STORE_NAME);
        }
      };

      request.onblocked = () => {
        clearTimeout(timer);
        console.warn('Apertura de IndexedDB bloqueada por otra pestaña');
        resolve(null);
      };

      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        cachedDB = db;
        db.onversionchange = () => {
          db.close();
          cachedDB = null;
        };
        db.onclose = () => {
          cachedDB = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        clearTimeout(timer);
        console.warn('No se pudo abrir IndexedDB:', request.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('Error iniciando conexión con IndexedDB:', err);
      resolve(null);
    }
  });
}


export async function saveDirectoryHandle(handle) {
  try {
    if (!handle) return false;
    const folderName = handle.name || 'Carpeta de música';
    try {
      localStorage.setItem('musicPlayer_hasSavedFolder', 'true');
      localStorage.setItem('musicPlayer_savedFolderName', folderName);
    } catch (err) {
      console.warn('Error sincronizando localStorage para carpeta guardada:', err);
    }

    const db = await openDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(handle, 'last_dir_handle');
        store.put(folderName, 'last_dir_name');

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          console.warn('IndexedDB no pudo serializar el handle:', tx.error);
          resolve(true); // localStorage ya tiene el registro
        };
      } catch (err) {
        console.warn('Error en la transacción saveDirectoryHandle:', err);
        resolve(true);
      }
    });
  } catch (e) {
    console.warn('Error guardando directorio:', e);
    return false;
  }
}

export async function getSavedDirectoryHandle() {
  try {
    const db = await openDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const reqHandle = store.get('last_dir_handle');
        const reqName = store.get('last_dir_name');

        let handle = null;
        let name = null;

        reqHandle.onsuccess = () => { handle = reqHandle.result; };
        reqName.onsuccess = () => { name = reqName.result; };

        tx.oncomplete = () => {
          if (handle) {
            const folderName = name || handle.name || 'Carpeta guardada';
            try {
              localStorage.setItem('musicPlayer_hasSavedFolder', 'true');
              localStorage.setItem('musicPlayer_savedFolderName', folderName);
            } catch (e) {}
            resolve({
              handle,
              name: folderName
            });
          } else {
            resolve(null);
          }
        };
        tx.onerror = () => {
          console.warn('Error en transacción getSavedDirectoryHandle:', tx.error);
          resolve(null);
        };
        tx.onabort = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  } catch (e) {
    console.warn('Error recuperando directorio de IndexedDB:', e);
    return null;
  }
}

export async function clearSavedDirectoryHandle() {
  try {
    try {
      localStorage.removeItem('musicPlayer_hasSavedFolder');
      localStorage.removeItem('musicPlayer_savedFolderName');
      localStorage.removeItem('musicPlayer_savedSongCount');
    } catch (e) {}

    const db = await openDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete('last_dir_handle');
        store.delete('last_dir_name');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (err) {
        resolve(true);
      }
    });
  } catch (e) {
    console.warn('Error limpiando directorio de IndexedDB:', e);
    return false;
  }
}

export async function saveCachedLibrary(songs) {
  try {
    if (!songs || !Array.isArray(songs) || songs.length === 0) return false;
    const db = await openDB();
    if (!db) return false;

    // Preservar metadatos y coverBlob, pero remover instancias no serializables como rawFile o fileEntry
    const serializableSongs = songs.map(s => {
      const { rawFile, fileEntry, cover, ...rest } = s;
      return {
        ...rest,
        coverBlob: s.coverBlob || null
      };
    });

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readwrite');
        const store = tx.objectStore(META_STORE_NAME);
        store.put(serializableSongs, 'cached_songs');
        store.put(Date.now(), 'cached_timestamp');
        store.put(serializableSongs.length, 'cached_count');

        tx.oncomplete = () => {
          try {
            localStorage.setItem('musicPlayer_hasCachedSongs', 'true');
            localStorage.setItem('musicPlayer_cachedSongCount', String(serializableSongs.length));
          } catch (e) {}
          resolve(true);
        };
        tx.onerror = () => {
          console.warn('Error guardando catálogo en IndexedDB:', tx.error);
          resolve(false);
        };
      } catch (err) {
        console.warn('Error en transacción saveCachedLibrary:', err);
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('Error general en saveCachedLibrary:', err);
    return false;
  }
}

export async function getCachedLibrary() {
  try {
    const db = await openDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readonly');
        const store = tx.objectStore(META_STORE_NAME);
        const reqSongs = store.get('cached_songs');
        const reqTime = store.get('cached_timestamp');

        let rawSongs = null;
        let rawTime = null;

        reqSongs.onsuccess = () => { rawSongs = reqSongs.result; };
        reqTime.onsuccess = () => { rawTime = reqTime.result; };

        tx.oncomplete = () => {
          const songsList = rawSongs || reqSongs.result;
          if (Array.isArray(songsList) && songsList.length > 0) {
            const rehydratedSongs = songsList.map((s, idx) => {
              let coverUrl = null;
              if (s.coverBlob) {
                try {
                  coverUrl = URL.createObjectURL(s.coverBlob);
                } catch (e) {
                  console.warn('Error creando URL de carátula desde blob:', e);
                }
              }
              return {
                ...s,
                id: s.id !== undefined ? s.id : idx,
                cover: coverUrl,
                rawFile: null,
                fileEntry: null
              };
            });
            resolve({
              songs: rehydratedSongs,
              timestamp: rawTime || reqTime.result || null,
              count: rehydratedSongs.length
            });
          } else {
            resolve(null);
          }
        };
        tx.onerror = () => {
          console.warn('Error leyendo catálogo de IndexedDB:', tx.error);
          resolve(null);
        };
        tx.onabort = () => resolve(null);
      } catch (err) {
        console.warn('Error en transacción getCachedLibrary:', err);
        resolve(null);
      }
    });
  } catch (err) {
    console.warn('Error obteniendo biblioteca en caché:', err);
    return null;
  }
}

export async function clearCachedLibrary() {
  try {
    try {
      localStorage.removeItem('musicPlayer_hasCachedSongs');
      localStorage.removeItem('musicPlayer_cachedSongCount');
    } catch (e) {}

    const db = await openDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readwrite');
        const store = tx.objectStore(META_STORE_NAME);
        store.delete('cached_songs');
        store.delete('cached_timestamp');
        store.delete('cached_count');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (err) {
        resolve(true);
      }
    });
  } catch (err) {
    return false;
  }
}

// ==========================================
// RESISTENCIA DE FAVORITOS Y REPRODUCCIONES
// Almacenamiento duradero en IndexedDB (library_meta)
// Inmune a reubicación de carpetas, renombramiento o limpieza de caché
// ==========================================

export async function saveFavoritesToDB(favoritesData) {
  try {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readwrite');
        const store = tx.objectStore(META_STORE_NAME);
        store.put(favoritesData, 'user_favorites');
        store.put(Date.now(), 'user_favorites_updated_at');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  } catch (e) {
    return false;
  }
}

export async function getFavoritesFromDB() {
  try {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readonly');
        const store = tx.objectStore(META_STORE_NAME);
        const req = store.get('user_favorites');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  } catch (e) {
    return null;
  }
}

export async function savePlayCountsToDB(playCountsData) {
  try {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readwrite');
        const store = tx.objectStore(META_STORE_NAME);
        store.put(playCountsData, 'user_play_counts');
        store.put(Date.now(), 'user_play_counts_updated_at');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  } catch (e) {
    return false;
  }
}

export async function getPlayCountsFromDB() {
  try {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(META_STORE_NAME, 'readonly');
        const store = tx.objectStore(META_STORE_NAME);
        const req = store.get('user_play_counts');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  } catch (e) {
    return null;
  }
}

// ==========================================
// OPFS (Origin Private File System) CLONING
// Almacenamiento local permanente y autónomo de audio
// Cero diálogos, cero permisos en cada inicio, 0 ms de arranque
// ==========================================

export function isOPFSSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

export function getTrackStorageKey(song) {
  if (!song) return '';
  const rawKey = song.path || song.filename || String(song.id || '');
  // Sanitizar para que sea un nombre de archivo válido en OPFS
  return rawKey.replace(/[/\\?%*:|"<>]/g, '_');
}

export async function saveTrackToOPFS(trackKey, fileBlob) {
  if (!isOPFSSupported() || !trackKey || !fileBlob) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const musicDir = await root.getDirectoryHandle('music_tracks', { create: true });
    const fileHandle = await musicDir.getFileHandle(trackKey, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(fileBlob);
    await writable.close();
    return true;
  } catch (err) {
    console.warn('Error guardando pista en OPFS:', trackKey, err);
    return false;
  }
}

export async function getTrackFromOPFS(songOrKey) {
  if (!isOPFSSupported() || !songOrKey) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const musicDir = await root.getDirectoryHandle('music_tracks', { create: false });

    // 1. Clave primaria
    const primaryKey = typeof songOrKey === 'string' ? songOrKey : getTrackStorageKey(songOrKey);
    try {
      const fileHandle = await musicDir.getFileHandle(primaryKey);
      return await fileHandle.getFile();
    } catch (e) {
      // 2. Clave alternativa si es un objeto canción
      if (typeof songOrKey === 'object' && songOrKey) {
        if (songOrKey.filename) {
          const altKey = getTrackStorageKey({ filename: songOrKey.filename });
          if (altKey !== primaryKey) {
            try {
              const fileHandle = await musicDir.getFileHandle(altKey);
              return await fileHandle.getFile();
            } catch (err2) {}
          }
        }
        if (songOrKey.path) {
          const altKey2 = songOrKey.path.split(/[/\\]/).pop().replace(/[/\\?%*:|"<>]/g, '_');
          if (altKey2 !== primaryKey) {
            try {
              const fileHandle = await musicDir.getFileHandle(altKey2);
              return await fileHandle.getFile();
            } catch (err3) {}
          }
        }
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

export async function hasTrackInOPFS(songOrKey) {
  if (!isOPFSSupported() || !songOrKey) return false;
  try {
    const file = await getTrackFromOPFS(songOrKey);
    return !!file;
  } catch {
    return false;
  }
}

export async function deleteTrackFromOPFS(songOrKey) {
  if (!isOPFSSupported() || !songOrKey) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const musicDir = await root.getDirectoryHandle('music_tracks', { create: false });
    const key = typeof songOrKey === 'string' ? songOrKey : getTrackStorageKey(songOrKey);
    await musicDir.removeEntry(key);
    return true;
  } catch {
    return false;
  }
}

export async function listOPFSTracks() {
  if (!isOPFSSupported()) return [];
  try {
    const root = await navigator.storage.getDirectory();
    const musicDir = await root.getDirectoryHandle('music_tracks', { create: false });
    const list = [];
    for await (const name of musicDir.keys()) {
      list.push(name);
    }
    return list;
  } catch {
    return [];
  }
}

export async function clearOPFSTracks() {
  try {
    try {
      localStorage.removeItem('musicPlayer_hasClonedOPFS');
      localStorage.removeItem('musicPlayer_clonedCount');
    } catch (e) {}

    if (!isOPFSSupported()) return true;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('music_tracks', { recursive: true });
    return true;
  } catch {
    return true;
  }
}

export async function getStorageEstimate() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usageMB: Math.round((estimate.usage || 0) / (1024 * 1024)),
        quotaMB: Math.round((estimate.quota || 0) / (1024 * 1024)),
        usageGB: ((estimate.usage || 0) / (1024 * 1024 * 1024)).toFixed(2),
        quotaGB: ((estimate.quota || 0) / (1024 * 1024 * 1024)).toFixed(1)
      };
    }
  } catch {}
  return null;
}

export async function cloneLibraryToOPFS(songsList, onProgress, fileMap = null) {
  if (!isOPFSSupported() || !songsList || songsList.length === 0) {
    return { success: false, cloned: 0 };
  }

  try {
    const root = await navigator.storage.getDirectory();
    const musicDir = await root.getDirectoryHandle('music_tracks', { create: true });
    let clonedCount = 0;
    const total = songsList.length;

    for (let i = 0; i < total; i++) {
      const song = songsList[i];
      const key = getTrackStorageKey(song);

      // Si ya existe y tiene tamaño mayor a 0, omitimos volver a escribir
      try {
        const existing = await musicDir.getFileHandle(key, { create: false });
        const existingFile = await existing.getFile();
        if (existingFile && existingFile.size > 0) {
          clonedCount++;
          if (onProgress) onProgress(i + 1, total, song.title || song.filename, true);
          continue;
        }
      } catch (e) {
        // No existe aún en OPFS, procedemos a clonar
      }

      // Resolver archivo a escribir
      let fileToSave = song.rawFile;
      if (!fileToSave && song.fileEntry) {
        try {
          fileToSave = await song.fileEntry.getFile();
          song.rawFile = fileToSave;
        } catch (e) {}
      }

      if (!fileToSave && fileMap && fileMap.size > 0) {
        const keyPath = (song.path || '').toLowerCase();
        const keyName = (song.filename || '').toLowerCase();
        const entry = fileMap.get(keyPath) || fileMap.get(keyName);
        if (entry) {
          try {
            fileToSave = await entry.getFile();
            song.rawFile = fileToSave;
            song.fileEntry = entry;
          } catch (e) {}
        }
      }

      if (fileToSave) {
        try {
          const fileHandle = await musicDir.getFileHandle(key, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(fileToSave);
          await writable.close();
          clonedCount++;
        } catch (err) {
          console.warn('Error clonando pista en OPFS:', key, err);
        }
      }

      if (onProgress) {
        onProgress(i + 1, total, song.title || song.filename, false);
      }
    }

    try {
      localStorage.setItem('musicPlayer_hasClonedOPFS', 'true');
      localStorage.setItem('musicPlayer_clonedCount', String(clonedCount));
    } catch (e) {}

    return { success: true, cloned: clonedCount };
  } catch (err) {
    console.error('Error general en cloneLibraryToOPFS:', err);
    return { success: false, cloned: 0 };
  }
}
