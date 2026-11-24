export type StikSoundErrorCode =
  | "unsupported-image"
  | "unsupported-audio"
  | "unsupported-codec"
  | "encode-failed"
  | "file-too-large"
  | "url-rejected"
  | "remote-unavailable"
  | "trim-out-of-range"
  | "sticker-too-large"
  | "package-invalid"
  | "export-unsupported";

export type LocaleCode = "es" | "en";

export interface LocalizedErrorCopy {
  title: string;
  action: string;
}

export const ERROR_CATALOG: Record<StikSoundErrorCode, Record<LocaleCode, LocalizedErrorCopy>> = {
  "unsupported-image": {
    es: {
      title: "Este archivo no es una imagen compatible (usa PNG, WebP, JPG o GIF).",
      action: "Pega otra imagen con Ctrl+V/Cmd+V o arrastra un PNG o GIF."
    },
    en: {
      title: "This file is not a supported image (use PNG, WebP, JPG, or GIF).",
      action: "Paste another image or drop a PNG or GIF file."
    }
  },
  "unsupported-audio": {
    es: {
      title: "No se pudo leer este audio o el formato no es compatible.",
      action: "Usa un archivo MP3, WAV, OGG, M4A o pega un enlace válido de MyInstants."
    },
    en: {
      title: "Could not decode this audio or the format is unsupported.",
      action: "Use an MP3, WAV, OGG, M4A file or paste a valid MyInstants link."
    }
  },
  "unsupported-codec": {
    es: {
      title: "Este navegador no puede codificar el video o audio con los códecs disponibles.",
      action: "Descarga el paquete .stiksound.zip y ábrelo en la app de escritorio StikSound."
    },
    en: {
      title: "This browser build cannot encode this clip with its available codecs.",
      action: "Download the .stiksound.zip package and open it in the StikSound desktop app."
    }
  },
  "encode-failed": {
    es: {
      title: "Ocurrió un error al generar el archivo final.",
      action: "Intenta cambiar el formato de salida en ⋯ o reintenta con otro archivo."
    },
    en: {
      title: "Failed while encoding the output file.",
      action: "Try switching the export format in ⋯ or retry with another input."
    }
  },
  "file-too-large": {
    es: {
      title: "El archivo supera el límite permitido (20 MB imagen / 25 MB o 3 min audio).",
      action: "Usa un archivo más liviano o recórtalo previamente."
    },
    en: {
      title: "File exceeds the allowed size or duration limit (20 MB image / 25 MB or 3 min audio).",
      action: "Use a smaller file or trim it externally first."
    }
  },
  "url-rejected": {
    es: {
      title: "Enlace rechazado por seguridad: solo se permiten URLs HTTPS de MyInstants.",
      action: "Copia el enlace directo de myinstants.com e inténtalo de nuevo."
    },
    en: {
      title: "URL rejected by security policy: only HTTPS MyInstants links are allowed.",
      action: "Copy a valid myinstants.com link and try again."
    }
  },
  "remote-unavailable": {
    es: {
      title: "No se pudo obtener el sonido desde MyInstants.",
      action: "Verifica tu conexión o que el sonido siga disponible, o usa un audio local."
    },
    en: {
      title: "Could not retrieve the sound from MyInstants.",
      action: "Check your connection or that the sound still exists, or drop a local audio file."
    }
  },
  "trim-out-of-range": {
    es: {
      title: "El fragmento seleccionado debe durar entre 0.1 s y 5.0 s.",
      action: "Ajusta la barra de tiempo para encuadrar el audio dentro de 5 segundos."
    },
    en: {
      title: "The selected audio range must be between 0.1 s and 5.0 s.",
      action: "Adjust the timeline handles so the selection fits within 5 seconds."
    }
  },
  "sticker-too-large": {
    es: {
      title: "El sticker WebP supera el límite de 100 KB requerido por WhatsApp.",
      action: "Exporta como Video 5 s o usa una imagen más simple."
    },
    en: {
      title: "The WebP sticker could not fit under WhatsApp's 100 KB limit.",
      action: "Export as a 5s Video or try a simpler image."
    }
  },
  "package-invalid": {
    es: {
      title: "El paquete .stiksound.zip es inválido o contiene rutas inseguras.",
      action: "Verifica que sea un proyecto exportado por StikSound sin alteraciones."
    },
    en: {
      title: "The .stiksound.zip package is invalid or contains unsafe paths.",
      action: "Ensure this is an unmodified StikSound project package."
    }
  },
  "export-unsupported": {
    es: {
      title: "La exportación nativa directa a WhatsApp aún no está disponible.",
      action: "Exporta el Video de 5 s y súbelo manualmente como sticker con audio en WhatsApp."
    },
    en: {
      title: "Direct native WhatsApp sticker export is not supported yet.",
      action: "Export the 5s Video and upload it in WhatsApp as a sound sticker."
    }
  }
};

export class StikSoundError extends Error {
  public readonly code: StikSoundErrorCode;
  public readonly detail?: string;

  constructor(code: StikSoundErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "StikSoundError";
    this.code = code;
    this.detail = detail;
  }

  public getLocalized(locale: LocaleCode): LocalizedErrorCopy {
    return ERROR_CATALOG[this.code][locale];
  }
}

export function formatError(err: unknown, locale: LocaleCode): LocalizedErrorCopy & { code: StikSoundErrorCode } {
  if (err instanceof StikSoundError) {
    return { code: err.code, ...err.getLocalized(locale) };
  }
  return {
    code: "encode-failed",
    ...ERROR_CATALOG["encode-failed"][locale]
  };
}
