// @ts-check

import fs from 'fs';
import path from 'path';
import { Project } from 'ts-morph';
import ora from 'ora';
const spinner = ora('Compiling...');
spinner.start();

const project = new Project({
  tsConfigFilePath: './tsconfig.json'
});
const sourceFiles = project.getSourceFiles();

const getDeclareType = (declareLine, isArray) => {
  const parts = declareLine.split(':');
  let type = undefined;
  if (parts.length > 1) {
    type = parts[1].replace(';', '').replace(/=.+$/, '').trim();
  }
  if (isArray) {
    type = type.replace('[]', '');
  }

  if (type === 'any' || type === 'undefined' || type === 'null' || !Number.isNaN(Number(type))) {
    type = undefined;
  }

  if (['number', 'string', 'boolean', 'int', 'float'].includes(type)) {
    type = type.replace(/^(.)/, (matched, index, original) => matched.toUpperCase());
  }

  if (type === 'bigint') {
    type = 'BigInt';
  }

  return type;
};

const addPropDecorator = (cls) => {
  if (!cls) {
    return;
  }
  cls.getProperties().forEach((p) => {
    let type = getDeclareType(p.getText(), p.getType().isArray());
    if (type === undefined || type === null) {
      return;
    }
    // if (p.getSourceFile().getClass(type)) {
    //   addPropDecorator(p.getSourceFile().getClass(type));
    // } else {
    //   const importSourceFiles = p.getSourceFile().getReferencedSourceFiles();
    //   importSourceFiles.forEach((sf) => {
    //     if (sf.getClass(type)) {
    //       addPropDecorator(sf.getClass(type));
    //     }
    //   });
    // }
    p.addDecorator({ name: '_PropDeclareType', arguments: [type] });
  });
  if (cls.getExtends()) {
    addPropDecorator(cls.getExtends().getExpression().getType().getSymbolOrThrow().getDeclarations()[0]);
  }
};

let controllerFilesList = [];
let entityList = {};
sourceFiles.forEach((sf) => {
  sf.getClasses().forEach((cls) => {
    addPropDecorator(cls);
    cls.getDecorators().forEach((classDecorator) => {
      if (classDecorator.getName() === 'Controller' || classDecorator.getName() === 'Middleware') {
        controllerFilesList.push(
          cls
            .getSourceFile()
            .getFilePath()
            .replace(path.resolve() + '/src', '.')
        );
        cls.getMethods().forEach((cMethod) => {
          cMethod.getParameters().forEach((param) => {
            if (param.getDecorators().length > 0) {
              const paramType = param.getType();
              param.addDecorator({
                name: '_ParamDeclareType',
                arguments: [getDeclareType(param.getText(), paramType.isArray())]
              });
              // if (paramType.isClass()) {
              //   const requestValidateClass = paramType.getSymbolOrThrow().getDeclarations()[0];
              //   addPropDecorator(requestValidateClass);
              // }
            }
          });
        });
      } else if (classDecorator.getName() === 'Entity') {
        const filePath = sf
          .getFilePath()
          .replace(path.resolve('.') + '/src', '.')
          .replace(/\.ts$/, '');
        if (!entityList[filePath]) {
          entityList[filePath] = [];
        }
        entityList[filePath].push(cls.getName());
      }
    });
  });
});

let fileContent = '// this file is generated by compiler\n';
fileContent += 'global["$$_SUMMER_ENV"] = "' + process.env.SUMMER_ENV + '";';

if (fs.existsSync('./src/config/default.config.ts')) {
  if (fs.readFileSync('./src/config/default.config.ts', { encoding: 'utf-8' }).trim().length > 0) {
    fileContent += 'import * as defaultConfig from "./config/default.config";\n';
    fileContent += 'global["$$_DEFAULT_CONFIG"] = defaultConfig;\n';
  }
}

if (fs.existsSync(`./src/config/${process.env.SUMMER_ENV}.config.ts`)) {
  if (fs.readFileSync(`./src/config/${process.env.SUMMER_ENV}.config.ts`, { encoding: 'utf-8' }).trim().length > 0) {
    fileContent += `import * as envConfig from "./config/${process.env.SUMMER_ENV}.config";\n`;
    fileContent += 'global["$$_ENV_CONFIG"] = envConfig;\n';
  }
}

controllerFilesList.forEach((path, inx) => {
  fileContent += `import * as $M${inx} from '${path.replace(/\.ts$/, '')}';\n`;
});

controllerFilesList.forEach((path, inx) => {
  fileContent += `$M${inx};\n`;
});

const allEntities = [];
for (const path in entityList) {
  allEntities.push(...entityList[path]);
  fileContent += 'import { ' + entityList[path].join(',') + " } from '" + path + "';\n";
}

fileContent += 'global["$$_ENTITIES"] = [' + allEntities.join(',') + '];';
fs.writeFileSync('./src/auto-imports.ts', fileContent);

project.resolveSourceFileDependencies();
project.emitSync();
spinner.stop();
