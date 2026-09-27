// Markdown for organizer-written overviews/rules and project stories.
// react-markdown never renders raw HTML, and links are forced to http(s)/mailto.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const safeUrl = (url: string) => (/^(https?:|mailto:|\/|#)/i.test(url) ? url : "");

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrl}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
