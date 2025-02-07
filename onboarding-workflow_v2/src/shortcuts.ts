export async function runBash({
    script,
    env,
}: {
    script: string
    // deno-lint-ignore no-explicit-any
    env: any
}): Promise<{ status: Deno.ProcessStatus; stdout: string; stderr: string }> {
    const p = Deno.run({
        cmd: ['bash', script],
        stdout: 'piped',
        stderr: 'piped',
        env: env,
    })
    const [status, stdout, stderr] = await Promise.all([
        p.status(),
        p.output().then((res) => new TextDecoder().decode(res)),
        p.stderrOutput().then((res) => new TextDecoder().decode(res)),
    ])
    return { status, stdout, stderr }
}

export async function goshCli(...args: string[]) {
    const cmd = ['gosh-cli', '-j', ...args]
    const display_cmd = cmd.map((x) => `'${x}'`).join(' ')

    // Print current time
    const now = new Date();
    console.debug(`Current timestamp: ${now}`)

    console.debug(`gosh cli: ${display_cmd}`)
    const p = Deno.run({
        cmd,
        stderr: 'piped',
        stdout: 'piped',
    })
    const [status, stdout, stderr] = await Promise.all([
        p.status(),
        p.output().then((res) => new TextDecoder().decode(res)),
        p.stderrOutput().then((res) => new TextDecoder().decode(res)),
    ])
    if (stdout) {
        console.log('Stdout:', stdout)
    }
    if (stderr) {
        console.log('Stderr:', stderr)
    }
    console.log('Status:', status)
    if (status.success) {
        return JSON.parse(stdout)
    }
    throw new Error(`Process "${display_cmd}" return code ${status.code}\n${stdout}`)
}
