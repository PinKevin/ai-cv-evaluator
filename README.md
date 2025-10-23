# AI-Powered CV and Project Report Evaluator

## Description

This project is a backend service built with **NestJS** designed to automate the initial screening phase of a job application process. It accepts a candidate's CV and a project report (both in PDF format), evaluates them using an AI pipeline involving **Retrieval-Augmented Generation (RAG)** and **LLM Chaining**, and provides a structured JSON evaluation report. The evaluation uses internal reference documents (Job Description, Case Study Brief, Scoring Rubrics) as ground truth .

The service features asynchronous processing using **BullMQ** and **Redis** to handle potentially long-running AI tasks without blocking API requests . RAG is implemented locally using **LlamaIndex** with embeddings generated via the **Hugging Face Inference API** (`BAAI/bge-small-en-v1.5` model) stored in a local file-based vector store (`./storage`). The LLM Chaining for evaluation (CV, Project Report, Summary) is performed by making direct API calls to **OpenRouter** (using a free tier model like `mistralai/mistral-7b-instruct:free`) via NestJS's `HttpService`.

## Tech Stack

- **Framework:** NestJS (TypeScript)
- **Database:** PostgreSQL (via TypeORM)
- **Job Queue:** BullMQ with Redis
- **Vector Store/RAG:** LlamaIndex (local file storage)
- **Embedding Model:** Hugging Face Inference API (`BAAI/bge-small-en-v1.5` via `@llamaindex/embeddings-huggingface`)
- **LLM Service:** OpenRouter (e.g., `mistralai/mistral-7b-instruct:free` via direct HTTP calls with `@nestjs/axios`)
- **PDF Parsing:** `pdf-parse`

## Prerequisites

- Node.js (v18 or higher recommended)
- pnpm (or npm/yarn)
- Docker Desktop (for Redis, PostgreSQL - optional if installed locally)
- Access keys for:
  - Hugging Face (for embedding API during ingestion)
  - OpenRouter (for LLM API during evaluation)

## Setup Instructions

1.  **Clone the Repository:**

    ```bash
    git clone https://github.com/PinKevin/ai-cv-evaluator
    cd ai-cv-evaluator
    ```

2.  **Install Dependencies:**

    ```bash
    pnpm install
    ```

3.  **Set Up Environment Variables:**
    - Copy the example environment file:
      ```bash
      cp .env.example .env
      ```
    - Edit the `.env` file and fill in your database credentials (PostgreSQL), Redis connection details, Hugging Face API Key (`HUGGINGFACE_API_KEY`), and OpenRouter API Key (`OPENROUTER_KEY`).

4.  **Run Data Ingestion Script:**
    - This step reads the documents in the `data` folder, generates embeddings using the Hugging Face API, and saves the local vector index to the `./storage` folder. **This requires an internet connection and your Hugging Face API key.**
    - Run the script:
      ```bash
      npx ts-node ingest-data.ts
      ```
    - Wait for the "✅ Ingestion complete" message. You only need to run this once unless the reference documents change.

5.  **Run Database and Redis:**
    - Ensure your PostgreSQL and Redis instances are running and accessible with the credentials provided in your `.env` file. You can use Docker Compose or install them locally.

## Running the Application

Run your application with these methods.

```bash
# Development (with hot-reloading)
pnpm run start:dev

# Production build
pnpm run build
pnpm run start:prod
```

The application will typically start on http://localhost:3000.

## API Endpoints

### POST /upload

Uploads the candidate's CV and Project Report PDF files.

- Request Body:

  multipart/form-data with two fields:

  ```json
  { "cv": "The CV PDF file", "report": "The Project Report PDF file." }
  ```

- Response (Success): 201 Created

  ```json
  {
    "message": "Files successfully uploaded.",
    "cv": {
      "id": 1
    },
    "report": {
      "id": 2
    }
  }
  ```

- Response (Fail): 400 Bad Request

  ```json
  {
    "message": "CV and Project Report files are required.",
    "error": "Bad Request",
    "statusCode": 400
  }
  ```

### POST /evaluate

Triggers the asynchronous AI evaluation pipeline for the uploaded documents.

- Request Body:

  ```json
  {
    "jobTitle": "Backend Engineer",
    "cvId": 1,
    "reportId": 2
  }
  ```

- Response (Success): 201 Created

  ```json
  {
    "id": "1",
    "status": "queued"
  }
  ```

- Response (Fail): 400 Bad Request

  `message` array is based on validation error.

  ```json
  {
    "message": [
      "reportId should not be empty",
      "reportId must be a number conforming to the specified constraints"
    ],
    "error": "Bad Request",
    "statusCode": 400
  }
  ```

### GET /result/:id

Retrieves the status and result of an evaluation job.

- Response (Success): 200 OK

  Return when evaluation is not completed

  ```json
  {
    "id": "1",
    "status": "processing"
  }
  ```

- Response (Success): 200 OK

  Return when evaluation is completed and successfull

  ```json
  {
    "id": "1",
    "status": "completed",
    "result": {
      "cv_feedback": "The candidate demonstrates strong technical skills in backend development, ...",
      "cv_match_rate": 0.72,
      "project_score": 4.2,
      "overall_summary": "The candidate shows strong technical skills in backend development ...",
      "project_feedback": "The candidate demonstrates strong implementation of the required backend service with proper API design, ..."
    }
  }
  ```

- Response (Success): 200 OK

  Return when evaluation is failed

  ```json
  {
    "id": "1",
    "status": "failed"
  }
  ```

## Design Choices & Approach

- Framework: NestJS was chosen for its modular architecture, TypeScript support, and built-in features suitable for building robust backend applications.

- Asynchronous Processing: BullMQ with Redis ensures the /evaluate endpoint is non-blocking, providing immediate feedback to the user while handling potentially long AI processing times in the background . The EvaluationProcessor acts as the worker.

- Database: PostgreSQL is used via TypeORM for storing document metadata and evaluation results due to its reliability and support for JSONB data types.

- RAG Implementation: LlamaIndex is used for managing the RAG pipeline locally.
  - Ingestion: Reference documents (.txt files) are loaded, chunked, and embedded using the Hugging Face Inference API (BAAI/bge-small-en-v1.5 model via @llamaindex/embeddings-huggingface). This choice avoids downloading large embedding models locally, saving bandwidth during setup.

  - Storage: Embeddings and document chunks are stored in a simple local file-based vector store managed by LlamaIndex in the ./storage directory.

  - Retrieval: During evaluation, the VectorStoreIndex retriever fetches the most relevant context chunks based on similarity search to augment the LLM prompts.

- LLM Service: OpenRouter is accessed directly via HTTP requests (@nestjs/axios). This approach was chosen for simplicity and direct control over the API calls, avoiding potential compatibility issues or complexities sometimes encountered with abstraction layers like LangChain when targeting specific API providers. The mistralai/mistral-7b-instruct:free model is used as a capable free option.

- LLM Chaining: The evaluation follows a three-step chain, making separate calls to OpenRouter for CV evaluation, Project Report evaluation, and final summarization, using the RAG context retrieved in the previous step . This improves focus and modularity. response_format: { type: 'json_object' } is used to request structured JSON output directly from the LLM.

- Error Handling: Basic error handling is implemented for API calls (timeouts, status codes) and JSON parsing. Failed jobs update the status in the database . The use of OnModuleInit ensures the RAG index is loaded before processing jobs. PDF parsing errors are also caught.

## Error Handling & Resilience

- API Timeouts: API calls to OpenRouter have a configured timeout (e.g., 60 seconds).

- API Errors: Errors returned by the OpenRouter API (e.g., rate limits, key issues) are caught, logged, and result in a "failed" job status.

- JSON Parsing: Errors during JSON.parse() (if the LLM fails to return valid JSON despite the request) are caught, logged, and result in a "failed" job status, potentially including the raw AI response in the error details.

- Index Loading: The application checks if the LlamaIndex RAG index loaded successfully during startup. If not, jobs requiring RAG will fail immediately with an appropriate error message.

- PDF Parsing: Errors during PDF reading or parsing are caught and lead to a "failed" job status.

## Future Improvements

- Implement robust retry logic for API calls using BullMQ options or p-retry.

- Add more comprehensive input validation and sanitization.

- Implement authentication/authorization for the API endpoints.
