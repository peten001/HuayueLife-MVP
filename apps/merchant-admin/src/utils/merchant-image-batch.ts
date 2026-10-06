export async function uploadMerchantImageBatch<T extends { name: string }>(
  files: readonly T[],
  options: {
    validate: (file: T) => string;
    upload: (file: T) => Promise<unknown>;
    errorMessage: (error: unknown) => string;
    progress?: (completed: number, total: number) => void;
  },
) {
  let uploaded = 0;
  const errors: string[] = [];
  options.progress?.(0, files.length);
  for (const [index, file] of files.entries()) {
    const validation = options.validate(file);
    if (validation) {
      errors.push(`${file.name}：${validation}`);
    } else {
      try {
        await options.upload(file);
        uploaded += 1;
      } catch (error) {
        errors.push(`${file.name}：${options.errorMessage(error)}`);
      }
    }
    options.progress?.(index + 1, files.length);
  }
  return { uploaded, errors };
}
