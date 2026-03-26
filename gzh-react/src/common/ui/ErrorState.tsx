type Props = { message: string };

export default function ErrorState({ message }: Props) {
  return <div className="error-state">{message}</div>;
}
