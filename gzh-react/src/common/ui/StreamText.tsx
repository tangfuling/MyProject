type StreamTextProps = {
  content: string;
};

export default function StreamText({ content }: StreamTextProps) {
  return <pre className="stream-text">{content}</pre>;
}
