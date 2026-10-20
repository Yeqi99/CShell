import { StreamLanguage } from '@codemirror/language';

// Syntax support only; semantic completion is supplied by installed providers.
export const shellLanguage = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/"(?:[^"\\]|\\.)*"|'[^']*'/)) return 'string';
    if (stream.match(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z_0-9]*|\$[0-9?@#]/)) return 'variableName';
    if (stream.match(/\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|export|local|return)\b/)) return 'keyword';
    if (stream.match(/[|&;<>]+/)) return 'operator';
    stream.next(); return null;
  },
});
