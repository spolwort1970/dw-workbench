import { useCallback } from "react";

interface Props {
  getText: () => string;
  ext: string;
}

export default function SaveButton({ getText, ext }: Props) {
  const handleClick = useCallback(() => {
    const content = getText();
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `output${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getText, ext]);

  return (
    <button className="icon-btn" onClick={handleClick} title="Save to file">
      <SaveIcon />
      <span>Save</span>
    </button>
  );
}

function SaveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}
