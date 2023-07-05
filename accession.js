import axios from 'axios';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname,resolve } from 'path';

//Global variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//function to save results
async function outputResults(jsonResult,jsonOutput,buildPath) {
    fs.ensureDirSync(buildPath)
    fs.writeFileSync(
        resolve(buildPath,'result.json'),
        jsonResult,'utf8',err=>{
            console.log(err)
        }
        )
    fs.writeFileSync(
        resolve(buildPath,'output.json'),
        jsonOutput,'utf8',err=>{
            console.log(err)
        }
        )
    console.log("Output Saved Successfully");

}

// Regex finder for links
const findLinks = (text) => {

    //Regex objects
    const urlRegex = /(?:https?|ftp):\/\/[\w-]+(?:\.[\w-]+)+(?:[\w.,@?^=%&:/~+#-]*[\w@?^=%&/~+#-])?/gi;
    const regex =/\b[A-Za-z]+\/{1}[A-Z0-9:_\-\.]+$\b/g

    //Extract the links from the text
    let links = text.match(urlRegex);
    let accessionData =  links.map((word) =>word.match(regex)[0]);

    return accessionData || [];

};

//Extract the given file and return the Text and Links in the file
function extractLinksFromWordFile(filePath) {

    // Load the docx file as a binary
    const content = fs.readFileSync(filePath, 'binary');

    //parse the docx file
    var zip = new PizZip(content);
    const doc = new Docxtemplater(zip);
    doc.resolveData(); // Resolve docxtemplater variable replacement
    doc.render(); // Render the document (parse)

    // Get the full text and link data
    const fullText = doc.getFullText();
    const links = findLinks(fullText);
    const linksData=links.map((item) => item.split('/'));
    const data={text:fullText,linksData:linksData};


    return data;
}

//Regex function Identify accession numbers in the input text
async function accessionNumberRegex(text) {
    const accessionNumberRegex = /\b[A-Z0-9:_\-\.]+\b/g;
    let accessionNumbersList = text.match(accessionNumberRegex);
    accessionNumbersList = accessionNumbersList.filter((word) => word.length>1);
    return accessionNumbersList;
}

//Function to Fetch the namespace mapping using the `namespaces` API
async function fetchNamespaceMap() {
    try {

        //request to the API
        const response = await axios.get('https://registry.api.identifiers.org/restApi/namespaces');
        let namespaceMap = [];
        const obj = {};

        //Extract the namespace data
        response.data._embedded.namespaces.forEach((item) => {
            let namespace={};
            namespace['name'] = item.name;
            namespace['pattern'] = item.pattern;
            namespace['prefix'] = item.prefix;
            namespaceMap.push(namespace);
        });
        obj['namespaceMap'] = namespaceMap;


        return namespaceMap;
    } catch (error) {
        console.log('Error fetching namespace mapping:', error.message);
        return null;
    }
}

// fetch compactIdentifierResolvedURL using the `resolver` API
async function fetchDatabaseInfo(accessionNumber, namespace) {
    try {
        const compactIdentifier = `${namespace}:${accessionNumber}`;

        //request to the API
        const response = await axios
        .get(`https://resolver.api.identifiers.org/${compactIdentifier}`)
        .then((response) => response.data).catch((error) => null);
        
        //Extract the resolved URL from the response
        return response===null?null:response.payload.resolvedResources.map((item) => item.compactIdentifierResolvedUrl);
    } catch (error) {
        console.log(`Error fetching database info for ${accessionNumber}:`, error.message);
        return null;
    }
}



//Generate the XML output based on the fetched information
async function constructXML(accessionNumbers,prefix) {
    let xmlOutput = [];
    for (const item of accessionNumbers) {
        let compactIdentifierResolvedUrl = [];
        console.log(item)

        const resolvedURL = await fetchDatabaseInfo(item, prefix);
        if (resolvedURL!==null) {
            // xmlOutput += `<ext-link ext-link-type="uri" assigning-authority="${namespace.prefix}" xlink:href="${resolvedURL}">${item}</ext-link>\n`;
            compactIdentifierResolvedUrl=resolvedURL.map((compactIdentifierResolvedUrl) => `<ext-link ext-link-type="uri" assigning-authority="${prefix}" xlink:href="${compactIdentifierResolvedUrl}">${item}</ext-link>`);
        
        }
        else {
            console.log(`Unable to fetch URL for accession number ${item} : {}`);
        }
        xmlOutput.push({ accessionNumber:item,xmlData:compactIdentifierResolvedUrl});
    }
    return xmlOutput;
}




//Base function to generate the XML output
async function generateXMLOutput(filepath) {

    let xmlDataObject = {};
    const buildPath =resolve(__dirname,'output');
    fs.removeSync(buildPath)
    
    const {text,linksData} =extractLinksFromWordFile(filePath);
    const namespaceMap = await fetchNamespaceMap();
    const accessionNumbersList=await accessionNumberRegex(text);

    console.log(linksData);
    console.log(accessionNumbersList);


    console.log('-----------------Processing Keywords-----------------------');
    for (const namespace of namespaceMap) {
        console.log('----------------------------------------');
        console.log(`Processing namespace ${namespace.name}`);

        try {
            
            var regexObj = new RegExp((namespace.pattern), "g"); 
            console.log(regexObj)
            /* 
            Alternative regex
            //const regex = /+${namespace.pattern}+/i;
            // var regexObj = new RegExp((namespace.pattern.slice(1, -1)), "g"); 
            // var regexObj = new RegExp((' '+namespace.pattern.slice(1, -1)+' '), "g");
            */

            // find accession numbers in the list of Keywords
            const accessionNumbers = accessionNumbersList.filter((word) => regexObj.test(word));
            console.log(accessionNumbers)

            //Generate the XML data for the given namespace
            if(accessionNumbers.length!==0) {
                let xml = await constructXML(accessionNumbers,namespace.prefix);
                xmlDataObject[namespace.name] = {
                    prefix: namespace.prefix,
                    name:namespace.name,
                    accessionNumbers:accessionNumbers,
                    xml:xml 
                };
            }

        } catch (error) {
            console.log(`Namespace not found for prefix ${error}`);
        }
    }

    console.log('--------------Processing Links-----------------');
    for(const item of linksData) {
        
        //Generate the XML data for the given links
        let xmlList = await constructXML([item[1]],item[0]);
        
        console.log(item)
        console.log(xmlList);

        if(xmlList[0].xmlData.length!==0) {
            if(item[0] in xmlDataObject ) {
                xmlDataObject[item[0]].xml.push(...xmlList);
                xmlDataObject[item[0]].accessionNumbers.push(item[1]);
            }
            else if(item[0]+"(prefix)" in xmlDataObject) {
                xmlDataObject[item[0]+"(prefix)"].xml.push(...xmlList);
                xmlDataObject[item[0]+"(prefix)"].accessionNumbers.push(item[1]);
            }
            else { 
                xmlDataObject[item[0]+"(prefix)"] = {
                    prefix: item[0],
                    name:item[0]+"(prefix)",
                    accessionNumbers:[item[1]],
                    xml:xmlList
                };
                
            }
        }
    }
    const result =JSON.stringify(xmlDataObject,null,"\t");
    const output =[]
    for (const key in xmlDataObject) {
        output.push(...xmlDataObject[key].xml)
    }


    outputResults(result,JSON.stringify(output,null,2),buildPath);
    console.log(JSON.stringify(output,null,2)); // You can write this XML output to a file or use it as needed.
}

const filePath = './data.docx';

generateXMLOutput(filePath);



