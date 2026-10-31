import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';

// Architecture regression, not a claim of installed/dynamic coverage. Typed
// Firestore direct writes must not silently reappear outside the one adapter.
// Auth, Storage and provider/file effects are tracked separately in the inventory.
function directWriters(program: ts.Program) {
  const checker=program.getTypeChecker(), found: string[]=[];
  for(const source of program.getSourceFiles()) {
    if(!source.fileName.replaceAll('\\','/').includes('/functions/src/')) continue;
    function visit(node: ts.Node) {
      if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method=node.expression.name.text;
        const type=checker.getTypeAtLocation(node.expression.expression).getSymbol()?.getName();
        const direct=(['DocumentReference','CollectionReference'].includes(type??'') && ['create','set','update','delete','add'].includes(method))
          || (type==='Firestore' && ['batch','bulkWriter','recursiveDelete'].includes(method));
        if(direct) found.push(`${path.basename(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line+1}:${type}.${method}`);
        if(type==='Firestore' && method==='runTransaction') {
          // The two remaining unguarded transactions serve read-only access.
          // Their actual read-only routing is also covered by handler tests.
          const file=path.basename(source.fileName);
          if(!['auroraWriterGuardian.ts','auroraRuntime.ts','auroraOrganicRuntime.ts'].includes(file)) found.push(`${file}:unguarded transaction`);
          if(file==='auroraRuntime.ts') {
            let parent:ts.Node|undefined=node;
            while(parent&&!ts.isFunctionDeclaration(parent))parent=parent.parent;
            if(!parent||!ts.isFunctionDeclaration(parent)||parent.name?.text!=='loadInstallationReadiness')found.push(`${file}:unguarded writer`);
          }
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  return found;
}

test('typed Firestore writers cannot bypass the canonical transaction adapter', () => {
  const root=process.cwd(), config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
  assert.equal(config.error,undefined);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
  const program=ts.createProgram(parsed.fileNames,parsed.options);
  assert.deepEqual(directWriters(program),[]);
});


test('the architecture scan detects an injected direct Firestore writer', () => {
  const filename=path.join(process.cwd(),'src','synthetic-direct-writer.ts');
  const input='declare class DocumentReference {set(data: unknown): Promise<void>}; declare const ref: DocumentReference; ref.set({});';
  const host=ts.createCompilerHost({noLib:true});
  host.getSourceFile=(file,version)=>file===filename?ts.createSourceFile(file,input,version,true):undefined;
  const program=ts.createProgram([filename],{noLib:true},host);
  assert.deepEqual(directWriters(program),['synthetic-direct-writer.ts:1:DocumentReference.set']);
});
