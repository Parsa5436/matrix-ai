-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voiceId" TEXT,
    "personaPrompt" TEXT NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "corpusVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentNorm" TEXT NOT NULL,
    "embedding" vector(768),

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exemplar" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "corpusVersion" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "questionNorm" TEXT NOT NULL,
    "options" JSONB,
    "answer" TEXT NOT NULL,
    "solutionMd" TEXT NOT NULL,
    "methodTags" TEXT[],
    "difficulty" INTEGER,
    "embedding" vector(768),

    CONSTRAINT "Exemplar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MethodCard" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "corpusVersion" INTEGER NOT NULL,
    "contentMd" TEXT NOT NULL,
    "teacherApproved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MethodCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestFlag" (
    "id" TEXT NOT NULL,
    "corpusVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "sourcePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subject_title_key" ON "Subject"("title");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_name_key" ON "Teacher"("name");

-- CreateIndex
CREATE INDEX "Chapter_subjectId_idx" ON "Chapter"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_subjectId_title_key" ON "Chapter"("subjectId", "title");

-- CreateIndex
CREATE INDEX "Topic_chapterId_idx" ON "Topic"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_chapterId_title_key" ON "Topic"("chapterId", "title");

-- CreateIndex
CREATE INDEX "Chunk_subjectId_corpusVersion_idx" ON "Chunk"("subjectId", "corpusVersion");

-- CreateIndex
CREATE INDEX "Chunk_topicId_corpusVersion_idx" ON "Chunk"("topicId", "corpusVersion");

-- CreateIndex
CREATE INDEX "Exemplar_subjectId_corpusVersion_idx" ON "Exemplar"("subjectId", "corpusVersion");

-- CreateIndex
CREATE INDEX "Exemplar_topicId_corpusVersion_idx" ON "Exemplar"("topicId", "corpusVersion");

-- CreateIndex
CREATE INDEX "MethodCard_topicId_corpusVersion_idx" ON "MethodCard"("topicId", "corpusVersion");

-- CreateIndex
CREATE UNIQUE INDEX "MethodCard_topicId_corpusVersion_key" ON "MethodCard"("topicId", "corpusVersion");

-- CreateIndex
CREATE INDEX "IngestFlag_corpusVersion_idx" ON "IngestFlag"("corpusVersion");

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exemplar" ADD CONSTRAINT "Exemplar_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exemplar" ADD CONSTRAINT "Exemplar_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MethodCard" ADD CONSTRAINT "MethodCard_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
