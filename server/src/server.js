import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fs from "fs";
import path from "path";
import {fileURLToPath} from 'url';
import archiver from 'archiver';
import stream from 'stream';
import {Parser} from 'json2csv';

// Get the directory name of the current module file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
    logger: false
});
fastify.register(fastifyCors, {origin: '*'});

// Function to get professors
const getProfessors = () => {
    const professors = JSON.parse(fs.readFileSync('./public/professors.json', 'utf-8'));
    return professors;
}

// Function to get students
const getStudents = () => {
    const students = JSON.parse(fs.readFileSync('./public/students.json', 'utf-8'));
    return students;
}

// Route to get students
fastify.get('/students', async (request, reply) => {
    const students = getStudents();
    return students;

});

// Route to get professors
fastify.get('/professors', async (request, reply) => {
    const professors = getProfessors();
    const counts = {};

    for (const professor of professors) {
        const fullname = professor.nom + " " + professor.prenom;
        const dirPath = path.join(__dirname, `../public/data/${fullname}`);

        try {
            if (!fs.existsSync(dirPath)) {
                counts[professor.id] = 0;
                continue;
            }

            const files = fs.readdirSync(dirPath);
            counts[professor.id] = files.length;
        } catch (err) {
            console.error(`Error reading directory for ${fullname}:`, err);
            counts[professor.id] = 0;
        }
    }

    const professorsWithCounts = professors.map(professor => ({
        ...professor,
        count: counts[professor.id] || 0
    }));
    reply.send(professorsWithCounts);
});

// Route to update absence
fastify.post('/absent', async (request, reply) => {
    const professors = getProfessors();
    const students = getStudents();
    const updatedDate = request.body.currentDate;
    const updatedProfessorId = request.body.choosedProfessor;
    let professorName = '';
    const updatedStudents = request.body.students;

    // get Professor name from id
    professors.forEach(professor => {
        if (professor.id == updatedProfessorId) {
            professorName = professor.nom + " " + professor.prenom;
        }
    });

    // Update the in-memory students array
    updatedStudents.forEach(updatedStudent => {
        const student = students.find(u => u.id === updatedStudent.id);
        if (student) {
            student.isAbsent = updatedStudent.isAbsent;
        }
    });

    // Construct the file path with dynamic values
    const jsonFilePath = path.join(__dirname, `../public/data/${professorName}/${updatedDate}.json`);
    const dirPath = path.dirname(jsonFilePath); // Get the directory part of the path

    // Ensure the directory exists
    fs.mkdirSync(dirPath, {recursive: true});

    // Write the updated students array back to the JSON file
    try {
        fs.writeFileSync(jsonFilePath, JSON.stringify(students, null, 2));
        reply.send({success: true, file: `${updatedDate}.json`});
    } catch (error) {
        console.error('Error writing to JSON file:', error);
        reply.status(500).send({success: false, message: 'Failed to update JSON file'});
    }
});

// Download all files as a zip
fastify.post('/download-all', async (request, reply) => {
    const professors = getProfessors();
    const {id} = request.body;

    // Find the professor by ID
    const professor = professors.find(prof => prof.id == id);
    if (!professor) {
        return reply.status(404).send({error: 'Professor not found'});
    }

    const fullname = `${professor.nom} ${professor.prenom}`;
    const dirPath = path.join(__dirname, `../public/data/${fullname}`);

    try {
        // Check if directory exists and list files
        const files = await fs.promises.readdir(dirPath);
        if (!files.length) {
            return reply.status(404).send({error: 'Directory is empty or not found'});
        }

        // Create a PassThrough stream for the zip
        const zipStream = new stream.PassThrough();
        const archive = archiver('zip', {zlib: {level: 9}});

        reply
            .header('Content-Type', 'application/zip')
            .header('Content-Disposition', `attachment; filename="${fullname}.zip"`);

        // Pipe the archive data to the zip stream, which is then sent in the response
        archive.pipe(zipStream);

        // Loop over files, convert JSON to CSV with modified attendance values, and add each to the archive
        for (const file of files) {
            const filePath = path.join(dirPath, file);

            if (path.extname(file) === '.json') {
                // Read JSON file content
                const jsonData = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));

                // Replace `true` with "Absent" and `false` with "Present" for the `isAbsent` field
                const modifiedData = jsonData.map(item => ({
                    ...item,
                    isAbsent: item.isAbsent ? 'Absent' : 'Present'
                }));

                // Convert modified JSON to CSV with a semicolon delimiter
                const json2csvParser = new Parser({delimiter: ';'});
                const csvData = json2csvParser.parse(modifiedData);

                // Add CSV data as a file to the archive
                const csvFileName = `${path.basename(file, '.json')}.csv`;
                archive.append(csvData, {name: csvFileName});
            }
        }

        // Finalize the archive
        await archive.finalize();
        zipStream.on('end', () => console.log('Zip stream finished'));

        // Send the zip stream in the response
        return reply.send(zipStream);

    } catch (err) {
        return reply.status(500).send({error: 'Error processing files'});
    }
});

// Route to get list of files
fastify.get('/lists/:id', async (request, reply) => {
    const professors = getProfessors();
    const {id} = request.params;

    const professor = professors.find(prof => prof.id == id);
    if (!professor) {
        return reply.status(404).send({error: 'Professor not found'});
    }

    const fullname = `${professor.nom} ${professor.prenom}`;
    const dirPath = path.join(__dirname, `../public/data/${fullname}`);

    // Check if directory exists by reading its contents
    const files = await fs.promises.readdir(dirPath);
    try {
        if (!files.length) {
            return reply.status(404).send({error: 'Directory is empty or not found'});
        }
    } catch (err) {
        return reply.status(404).send({error: 'Directory not found'});
    }
    files.sort((a, b) => b.localeCompare(a));
    return files;
});

// Route to download a file
fastify.post('/download', async (request, reply) => {
    const professors = getProfessors();
    const {id, element} = request.body;

    // Find the professor by ID
    const professor = professors.find(prof => prof.id == id);
    if (!professor) {
        return reply.status(404).send({error: 'Professor not found'});
    }

    const fullname = `${professor.nom} ${professor.prenom}`;
    const filePath = path.join(__dirname, `../public/data/${fullname}`, element);

    try {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            return reply.status(404).send({error: 'File not found'});
        }

        // Read the file content
        const fileContent = await fs.promises.readFile(filePath, 'utf8');

        // Replace `true` with "Absent" and `false` with "Present" for the `isAbsent` field
        const jsonData = JSON.parse(fileContent);
        const modifiedData = jsonData.map(item => ({
            ...item,
            isAbsent: item.isAbsent ? 'Absent' : 'Present'
        }));

        // Convert modified JSON to CSV with a semicolon delimiter
        const json2csvParser = new Parser({delimiter: ';'});
        const csvData = json2csvParser.parse(modifiedData);

        // Set the response headers and send the CSV data
        reply
            .header('Content-Type', 'text/csv')
            .header('Content-Disposition', `attachment; filename="${path.basename(element, '.json')}.csv"`)
            .send(csvData);

    } catch (err) {
        return reply.status(500).send({error: 'Error processing file'});
    }
});

// Route to get the absence list for a specific professor and date
fastify.get("/absence/:professorId/:date", async (request, reply) => {
    const professors = getProfessors();
    const {professorId, date} = request.params;

    const professor = professors.find((prof) => prof.id == professorId);
    if (!professor) {
        return reply.status(404).send({error: "Professor not found"});
    }

    const professorName = `${professor.nom} ${professor.prenom}`;
    const filePath = path.join(__dirname, `../public/data/${professorName}/${date}.json`);

    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            reply.send(data);
        } else {
            reply.send([]);
        }
    } catch (error) {
        console.error("Error reading absence data:", error);
        reply.status(500).send({error: "Failed to retrieve absence data"});
    }
});

// Route to update the absence list for a specific professor and date
fastify.post("/absence/update", async (request, reply) => {
    const professors = getProfessors();
    const {currentDate, choosedProfessor, students} = request.body;

    const professor = professors.find((prof) => prof.id == choosedProfessor);
    if (!professor) {
        return reply.status(404).send({error: "Professor not found"});
    }

    const professorName = `${professor.nom} ${professor.prenom}`;
    const filePath = path.join(__dirname, `../public/data/${professorName}/${currentDate}.json`);
    const dirPath = path.dirname(filePath);

    try {
        fs.mkdirSync(dirPath, {recursive: true});
        fs.writeFileSync(filePath, JSON.stringify(students, null, 2));
        reply.send({success: true, file: `${currentDate}.json`});
    } catch (error) {
        console.error("Error updating absence data:", error);
        reply.status(500).send({success: false, message: "Failed to update absence data"});
    }
});

// Route to create a new professor
fastify.post('/create/professor', async (request, reply) => {
    const {FirstName, LastName} = request.body;
    const professors = getProfessors();
    const newProfessor = {
        id: professors.length + 1,
        nom: LastName,
        prenom: FirstName
    };
    professors.push(newProfessor);
    fs.writeFileSync('./public/professors.json', JSON.stringify(professors, null, 2));
    reply.send({success: true});
});

// Route to create a new student
fastify.post('/create/student', async (request, reply) => {
    const students = getStudents();
    const {FirstName, LastName} = request.body;

    const newStudent = {
        id: students.length + 1,
        nom: LastName,
        prenom: FirstName
    };
    students.push(newStudent);
    fs.writeFileSync('./public/students.json', JSON.stringify(students, null, 2));
    reply.send({success: true});
});

// server start (npm start)
try {
    fastify.listen({port: 3001})
} catch (err) {
    fastify.log.error(err)
    process.exit(1)
}