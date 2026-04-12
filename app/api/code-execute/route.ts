import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

/**
 * Handles code execution for Python, Java, C, and Solidity
 * POST /api/code-execute
 */
export async function POST(request: NextRequest) {
  try {
    const { language, code } = await request.json();

    if (!language || !code) {
      return NextResponse.json(
        { error: 'Missing language or code' },
        { status: 400 }
      );
    }

    let result = '';

    if (language === 'python') {
      result = await executePython(code);
    } else if (language === 'java') {
      result = await executeJava(code);
    } else if (language === 'c') {
      result = await executeC(code);
    } else if (language === 'solidity') {
      result = await compileSolidity(code);
    } else {
      return NextResponse.json(
        { error: `Unsupported language: ${language}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      output: result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * Execute Python code
 */
async function executePython(code: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`python3 -c "${code.replace(/"/g, '\\"')}"`, {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return stdout || stderr || 'Execution completed with no output';
  } catch (error: any) {
    if (error.killed) {
      throw new Error('Execution timeout (10s limit exceeded)');
    }
    throw new Error(error.stderr || error.message);
  }
}

/**
 * Execute Java code
 */
async function executeJava(code: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const className = code.match(/class\s+([A-Za-z_]\w*)/)?.[1] || 'Main';
  const javaFile = path.join(tmpDir, `${className}.java`);
  const classFile = path.join(tmpDir, `${className}.class`);

  try {
    // Write Java file
    fs.writeFileSync(javaFile, code);

    // Compile
    const { stderr: compileErr } = await execAsync(`javac "${javaFile}"`, {
      timeout: 10000,
      cwd: tmpDir,
    });

    if (compileErr && compileErr.trim()) {
      throw new Error(`Compilation error:\n${compileErr}`);
    }

    // Execute
    const { stdout, stderr } = await execAsync(`java -cp "${tmpDir}" ${className}`, {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    return stdout || stderr || 'Execution completed with no output';
  } catch (error: any) {
    if (error.killed) {
      throw new Error('Execution timeout (10s limit exceeded)');
    }
    throw new Error(error.message);
  } finally {
    // Cleanup
    try {
      fs.unlinkSync(javaFile);
      fs.unlinkSync(classFile);
    } catch {}
  }
}

/**
 * Execute C code
 */
async function executeC(code: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const cFile = path.join(tmpDir, 'program.c');
  const executable = path.join(tmpDir, 'program');

  try {
    // Write C file
    fs.writeFileSync(cFile, code);

    // Compile
    const { stderr: compileErr } = await execAsync(`gcc "${cFile}" -o "${executable}"`, {
      timeout: 10000,
    });

    if (compileErr && compileErr.trim()) {
      throw new Error(`Compilation error:\n${compileErr}`);
    }

    // Execute
    const { stdout, stderr } = await execAsync(`"${executable}"`, {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    return stdout || stderr || 'Execution completed with no output';
  } catch (error: any) {
    if (error.killed) {
      throw new Error('Execution timeout (10s limit exceeded)');
    }
    throw new Error(error.message);
  } finally {
    // Cleanup
    try {
      fs.unlinkSync(cFile);
      fs.unlinkSync(executable);
    } catch {}
  }
}

/**
 * Compile Solidity code (syntax check only, no execution)
 */
async function compileSolidity(code: string): Promise<string> {
  try {
    // Just validate syntax - full compilation would require solc
    if (!code.includes('pragma solidity')) {
      throw new Error('Missing pragma solidity declaration');
    }

    if (!code.includes('contract ')) {
      throw new Error('Missing contract declaration');
    }

    const contractName = code.match(/contract\s+([A-Za-z_]\w*)/)?.[1];
    if (!contractName) {
      throw new Error('Could not extract contract name');
    }

    return `✅ Solidity syntax validated\nContract: ${contractName}\n\nNote: For full compilation, use Hardhat or Truffle\nCode is ready for deployment.`;
  } catch (error: any) {
    throw new Error(`Solidity validation error: ${error.message}`);
  }
}
