type AddClustersResult = {
  added: string[];
  errors: string[];
};

export function formatResultMessages(result: AddClustersResult): string[] {
  const messages: string[] = [];
  if (result.added.length > 0) {
    messages.push(
      `Added ${result.added.length} new cluster${result.added.length > 1 ? "s" : ""}: ${result.added.join(", ")}`,
    );
  }

  return messages;
}
