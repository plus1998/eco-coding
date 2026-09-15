import { Box, Info } from "lucide-react";
import "./FeedStatusDivider.css";

interface FeedStatusDividerProps {
  message: string;
  info?: string;
}

export function FeedStatusDivider({ message, info }: FeedStatusDividerProps) {
  const infoText = info?.trim() || message;

  return (
    <div className="feed-status-divider" role="status">
      <span className="feed-status-divider-line" aria-hidden />
      <span className="feed-status-divider-content">
        <Box className="feed-status-divider-kind-icon" size={15} strokeWidth={1.7} aria-hidden />
        <span className="feed-status-divider-message">{message}</span>
        <span className="feed-status-divider-info" role="img" title={infoText} aria-label={infoText}>
          <Info size={14} strokeWidth={1.7} aria-hidden />
        </span>
      </span>
      <span className="feed-status-divider-line" aria-hidden />
    </div>
  );
}
