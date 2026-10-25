import { z } from 'zod';

export const visualCapabilities = [
  'browser.read',
  'browser.control',
  'desktop.view',
  'desktop.control',
] as const;
export const browserTabInput = z.object({ tabId: z.string().uuid() }).strict();
export const browserOpenInput = z.object({ url: z.string().url().max(8192) }).strict();
export const browserSnapshotInput = browserTabInput.extend({
  frameId: z.string().min(1).max(200).optional(),
  maxText: z.number().int().min(100).max(100000).default(16000),
  maxElements: z.number().int().min(1).max(500).default(100),
});
export const browserCaptureInput = browserTabInput.extend({
  maxWidth: z.number().int().min(320).max(1920).default(1440),
  quality: z.number().int().min(20).max(90).default(75),
});
const element = {
  tabId: z.string().uuid(),
  frameId: z.string().min(1).max(200).optional(),
  snapshotId: z.string().uuid(),
  ref: z.string().regex(/^e\d{1,4}$/),
};
export const browserInteractInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), ...element }).strict(),
  z.object({ action: z.literal('fill'), ...element, text: z.string().max(16000) }).strict(),
  z.object({ action: z.literal('select'), ...element, value: z.string().max(1000) }).strict(),
  z
    .object({
      action: z.literal('scroll'),
      tabId: z.string().uuid(),
      frameId: z.string().min(1).max(200).optional(),
      x: z.number().int().min(-10000).max(10000).default(0),
      y: z.number().int().min(-10000).max(10000),
    })
    .strict(),
  z
    .object({
      action: z.literal('key'),
      tabId: z.string().uuid(),
      key: z.enum([
        'Enter',
        'Tab',
        'Escape',
        'Backspace',
        'Delete',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ]),
      modifiers: z
        .array(z.enum(['shift', 'control', 'alt']))
        .max(3)
        .default([]),
    })
    .strict(),
  z
    .object({ action: z.enum(['back', 'forward', 'reload', 'close']), tabId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal('navigate'),
      tabId: z.string().uuid(),
      url: z.string().url().max(8192),
    })
    .strict(),
]);
export const browserCrawlInput = z
  .object({
    tabId: z.string().uuid(),
    urls: z.array(z.string().url().max(8192)).min(1).max(5),
    maxText: z.number().int().min(100).max(20000).default(10000),
  })
  .strict();
export const screenshotOutput = z
  .object({
    mimeType: z.literal('image/jpeg'),
    dataBase64: z.string().max(2800000),
    width: z.number().int().positive().max(1920),
    height: z.number().int().positive().max(1920),
    target: z.string().max(200),
    frameId: z.string().max(100),
  })
  .strict();
export const browserSnapshotOutput = z
  .object({
    tabId: z.string().uuid(),
    frameId: z.string().max(200).optional(),
    snapshotId: z.string().uuid(),
    url: z.string().max(8192),
    title: z.string().max(1000),
    text: z.string().max(100000),
    truncated: z.boolean(),
    elements: z
      .array(
        z
          .object({
            ref: z.string(),
            role: z.string(),
            name: z.string(),
            tag: z.string(),
            href: z.string().optional(),
            disabled: z.boolean(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export const desktopCaptureInput = z
  .object({
    maxWidth: z.number().int().min(320).max(1920).default(1440),
    quality: z.number().int().min(20).max(90).default(75),
  })
  .strict();
export const desktopInteractInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('click'),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      button: z.enum(['left', 'right', 'middle']).default('left'),
      count: z.number().int().min(1).max(2).default(1),
    })
    .strict(),
  z
    .object({ action: z.literal('move'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .strict(),
  z
    .object({
      action: z.literal('scroll'),
      delta: z.number().int().min(-2000).max(2000),
      horizontal: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal('key'),
      code: z.number().int().min(1).max(511),
      modifiers: z.array(z.number().int().min(1).max(511)).max(3).default([]),
    })
    .strict(),
  z.object({ action: z.literal('text'), text: z.string().min(1).max(512) }).strict(),
  z.object({ action: z.literal('release') }).strict(),
]);
