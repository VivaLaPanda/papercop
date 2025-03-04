import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Set longer timeout for Anthropic API requests
const ANTHROPIC_TIMEOUT_MS = 50000; // 50 seconds

// Initialize the Anthropic client
// We get the API key from environment variables for security
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  timeout: ANTHROPIC_TIMEOUT_MS,
});

// This tells Next.js this route can take longer than the default timeout
export const maxDuration = 60; // Maximum duration in seconds for the Edge function

export async function POST(request: Request) {
  try {
    // Check if API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Anthropic API key is not configured" }, { status: 500 });
    }

    // Parse the request body
    const { fileName, fileContent } = await request.json();

    if (!fileName || !fileContent) {
      return NextResponse.json({ error: "File name and content are required" }, { status: 400 });
    }

    // The prompt for Claude, matching the Python script style
    const prompt = `Paper:

[PDF Content will be analyzed automatically]

Do an expert-level peer review on this. Make sure to be harsh but fair. After your review give a probability that the paper will be retracted. Put the probability as a percentage in double brackets exactly like this: [[X%]]`;

    console.log("Making API request to Claude...");

    // Make the API request to Claude
    const message = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 6000,
      thinking: { type: "enabled", budget_tokens: 2000 },
      system:
        "You are CiteCop, an AI assistant specializing in identifying papers that should be retracted.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: fileContent,
              },
            },
          ],
        },
      ],
    });

    console.log("Received response from Claude");

    // Log the raw message structure to better understand what we're getting
    console.log("Claude response structure:", JSON.stringify(message, null, 2).substring(0, 300));

    // Log information about the response content
    console.log(`Content blocks: ${message.content.length}`);
    message.content.forEach((block, i) => {
      console.log(`Block ${i} type: ${JSON.stringify(block)}`);
    });

    // Find the text block in the content array
    const textBlock = message.content.find(
      block => typeof block === "object" && "type" in block && block.type === "text",
    );

    // Get the response text from the text block
    const responseText = textBlock && "text" in textBlock ? (textBlock.text as string) : "";

    // Make sure we have a response
    if (!responseText) {
      console.log("No text content found in the response");
      return NextResponse.json({ error: "No text content in Claude's response" }, { status: 500 });
    }

    // Log the first and last parts of the response text (to avoid overwhelming logs)
    console.log(`Response text length: ${responseText.length}`);
    console.log(`Response text prefix (200 chars): ${responseText.substring(0, 200)}...`);
    console.log(
      `Response text suffix (200 chars): ...${responseText.substring(responseText.length - 200)}`,
    );

    // Find percentage - first try with double brackets
    const extractPercentage = (text: string): number => {
      // First try the specified format
      const match = text.match(/\[\[(\d+(?:\.\d+)?)%?\]\]/);
      if (match) {
        console.log(`Found percentage match: ${match[0]} at position ${text.indexOf(match[0])}`);
        try {
          return parseFloat(match[1]);
        } catch {
          console.log(`Failed to parse percentage from match: ${match[1]}`);
          return 0;
        }
      }

      // Try other formats that might contain percentage in conclusion
      const percentagePatterns = [
        /probability of retraction is (\d+(?:\.\d+)?)%/i,
        /retraction probability of (\d+(?:\.\d+)?)%/i,
        /likelihood of retraction: (\d+(?:\.\d+)?)%/i,
        /retraction likelihood: (\d+(?:\.\d+)?)%/i,
        /(\d+(?:\.\d+)?)% likelihood/i,
        /(\d+(?:\.\d+)?)% probability/i,
        /(\d+(?:\.\d+)?)% chance/i,
      ];

      for (const pattern of percentagePatterns) {
        const altMatch = text.match(pattern);
        if (altMatch) {
          console.log(`Found alternative percentage pattern: ${altMatch[0]}`);
          try {
            return parseFloat(altMatch[1]);
          } catch {
            console.log(`Failed to parse from alternative pattern: ${altMatch[1]}`);
          }
        }
      }

      console.log("No percentage pattern found in response text");
      return 0;
    };

    const retractedPercentage = extractPercentage(responseText);
    console.log(`Extracted percentage: ${retractedPercentage}%`);

    // Extract analysis - try several strategies to get a meaningful summary
    let analysis = "Analysis not found";

    // 1. Try to find a conclusion section
    const conclusionMatch = responseText.match(/(?:conclusion|summary):(.*?)(?:\n\n|\n$|$)/i);
    if (conclusionMatch && conclusionMatch[1].trim().length > 10) {
      analysis = conclusionMatch[1].trim();
      console.log(`Found conclusion section: ${analysis.substring(0, 100)}...`);
    }
    // 2. Try to find the last substantial paragraph before any mention of percentage
    else {
      const paragraphs = responseText
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
      console.log(`Found ${paragraphs.length} paragraphs in the text`);

      if (paragraphs.length > 0) {
        // Use the last substantial paragraph (at least 100 chars)
        const substantialParagraphs = paragraphs.filter(p => p.length > 100);
        if (substantialParagraphs.length > 0) {
          analysis = substantialParagraphs[substantialParagraphs.length - 1];
          console.log(`Using last substantial paragraph: ${analysis.substring(0, 100)}...`);
        } else {
          // Fallback to the last paragraph
          analysis = paragraphs[paragraphs.length - 1];
          console.log(`Using last paragraph as fallback: ${analysis.substring(0, 100)}...`);
        }
      }
    }

    // Chain of thought is the entire response
    const chainOfThought = responseText;

    // Return the parsed analysis
    console.log("Returning analysis results");
    return NextResponse.json({
      retractedPercentage,
      analysis,
      chainOfThought,
      fileName,
    });
  } catch (error) {
    console.error("Error analyzing PDF:", error);

    // Provide more specific error for timeout cases
    if (error instanceof Error && error.message.includes("timeout")) {
      return NextResponse.json(
        {
          error:
            "Analysis timed out. The PDF may be too large or complex to process within the allocated time.",
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "An unknown error occurred" },
      { status: 500 },
    );
  }
}
