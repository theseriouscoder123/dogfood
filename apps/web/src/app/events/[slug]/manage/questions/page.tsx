import { getEvent } from "@/lib/data";
import { QuestionsEditor } from "../editors";

export default async function QuestionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { questions } = await getEvent(slug);
  return (
    <div>
      <h1 className="mb-6 text-3xl font-extrabold">Submission form</h1>
      <QuestionsEditor slug={slug} questions={questions} />
    </div>
  );
}
