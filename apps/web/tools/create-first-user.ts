import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createDatabase } from "@rosie/db";
import { Accounts } from "../src/server/auth/accounts";
import { loadConfig } from "../src/server/config";

if (process.argv.includes("--help")) {
  console.log(
    "Uso: pnpm user:create-first\nCria somente o primeiro administrador. Execute em um terminal; a senha não será exibida.",
  );
} else if (process.argv.length > 2 || !stdin.isTTY || !stdout.isTTY) {
  console.error(
    "Execute pnpm user:create-first em um terminal interativo, sem argumentos ou redirecionamentos.",
  );
  process.exitCode = 1;
} else {
  process.umask(0o077);
  const db = createDatabase(loadConfig().databaseUrl);
  let hidden = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!hidden) stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: stdin, output, terminal: true });
  const secret = async (label: string) => {
    stdout.write(label);
    hidden = true;
    try {
      return await rl.question("");
    } finally {
      hidden = false;
      stdout.write("\n");
    }
  };
  rl.on("SIGINT", () => {
    hidden = false;
    stdout.write("\nCadastro cancelado.\n");
    rl.close();
    process.exitCode = 1;
  });
  try {
    if (
      (await db.user.count()) ||
      (await db.setting.findUnique({ where: { id: "user-bootstrap-complete" } }))
    )
      throw new Error(
        "O primeiro usuário já existe. Crie os demais em Usuários, dentro do painel.",
      );
    const name = await rl.question("Nome: "),
      username = await rl.question("Usuário: ");
    const password = await secret("Senha (mínimo 8 caracteres): "),
      confirmation = await secret("Repita a senha: ");
    if (password !== confirmation)
      throw new Error("As senhas não coincidem. Nenhuma conta foi criada.");
    await new Accounts(db).bootstrap({ name, username, password, role: "admin", enabled: true });
    console.log(
      "Primeiro administrador criado. Entre no painel com seu usuário e senha. Os demais usuários são cadastrados em Usuários.",
    );
  } catch (error) {
    // Validation messages never include the rejected credential value.
    const message =
      error instanceof Error && error.name !== "ZodError"
        ? error.message
        : "Confira o nome, o usuário (3–40 caracteres) e a senha (8–128 caracteres).";
    console.error(message);
    process.exitCode = 1;
  } finally {
    hidden = false;
    rl.close();
    await db.$disconnect();
  }
}
