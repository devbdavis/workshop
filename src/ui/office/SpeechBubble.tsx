interface Props {
  text: string;
}

/**
 * Speech bubble overlay for the dying state — white bubble with tail triangle.
 * Pulses via the `office-speech-bubble` CSS class.
 */
export function SpeechBubble({ text }: Props) {
  return (
    <div
      className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4
                 bg-white text-gray-900 text-xs px-2 py-1 rounded-lg
                 shadow-md office-speech-bubble"
    >
      {text}
      {/* Tail triangle */}
      <div
        className="absolute bottom-0 left-3 translate-y-full
                   w-0 h-0 border-l-4 border-r-4 border-t-4
                   border-transparent border-t-white"
      />
    </div>
  );
}
