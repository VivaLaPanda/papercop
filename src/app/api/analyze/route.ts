import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Initialize the Anthropic client
// We get the API key from environment variables for security
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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

Do an expert-level peer review on this. Make sure to be harsh but fair. After your review give a probability that the paper will be retracted. Put the probability as a percentage in double brackets.`;

    // Make the API request to Claude
    const message = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20240219", // Updated to use Claude 3.7 Sonnet like the Python script
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

    // Get the response text
    const responseText =
      typeof message.content[0] === "object" && "text" in message.content[0]
        ? (message.content[0].text as string)
        : "";

    // Extract percentage using regex, matching the Python script's approach
    const extractPercentage = (text: string): number => {
      const match = text.match(/\[\[(\d+(?:\.\d+)?)%?\]\]/);
      if (match) {
        try {
          return parseFloat(match[1]);
        } catch {
          return 0;
        }
      }
      return 0;
    };

    const retractedPercentage = extractPercentage(responseText);

    // For the analysis, get everything before the double bracketed percentage
    const lastIndex = responseText.lastIndexOf("[[");
    const analysis =
      lastIndex > 0
        ? responseText.substring(responseText.lastIndexOf("\n\n", lastIndex) + 2, lastIndex).trim()
        : "Analysis not found";

    // Chain of thought is the entire response
    const chainOfThought = responseText;

    // Return the parsed analysis
    return NextResponse.json({
      retractedPercentage,
      analysis,
      chainOfThought,
      fileName,
    });
  } catch (error) {
    console.error("Error analyzing PDF:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "An unknown error occurred" },
      { status: 500 },
    );
  }
}
